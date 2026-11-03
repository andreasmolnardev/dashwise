// Computed-value evaluation for YAML integrations. This is a deliberately
// bounded interpreter: it supports the documented scalar expression subset
// (comparisons, and/or/not, contains, numeric addition/subtraction and
// multiplication/division, lookup tables and conditional values) driven by
// configuration maps. Expressions can only read the integration scope
// (endpoints, computed results, lookup tables, the current item and
// environment variables); no arbitrary code is executed and unsupported
// constructs fail closed.
package yamlruntime

import (
	"errors"
	"fmt"
	"math"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	// maxComputedDepth bounds recursion when resolving computed values.
	maxComputedDepth = 25
	// maxComputedPasses bounds the fixpoint loop that lets computed fields
	// reference sibling fields declared later in the same definition.
	maxComputedPasses = 3
	// maxExpressionTokens bounds the size of an accepted expression.
	maxExpressionTokens = 2048
	// maxExpressionDepth bounds parser and operand nesting.
	maxExpressionDepth = 24
)

var inlineIfPattern = regexp.MustCompile(`^if\s*\((.*)\)$`)

// evaluateComputed resolves the configuration.computed map against the scope in
// root. Definitions (and fields) are evaluated in sorted order, and results are
// recomputed for up to maxComputedPasses rounds so references to values that
// only become available later (e.g. computed.weather.rain_message consumed by
// computed.weather.insight) converge on their final values.
func evaluateComputed(definitions map[string]any, root map[string]any, env map[string]string, endpoints map[string]EndpointResult) map[string]any {
	base := &computedResolver{root: root, env: env, endpoints: endpoints}
	result := map[string]any{}
	for pass := 0; pass < maxComputedPasses; pass++ {
		out := base.evaluatePass(definitions)
		if reflect.DeepEqual(result, out) {
			break
		}
		result = out
	}
	return result
}

type computedResolver struct {
	root      map[string]any
	env       map[string]string
	endpoints map[string]EndpointResult
	item      map[string]any
	index     int
	// scope holds named inputs for expr operations and shadows everything else.
	scope map[string]any
}

// evaluatePass computes every definition and publishes each result on the
// root's "computed" object as it is produced, so later definitions (and later
// passes) can reference earlier results by path.
func (rv *computedResolver) evaluatePass(definitions map[string]any) map[string]any {
	out := make(map[string]any, len(definitions))
	computed := object(rv.root["computed"])
	for _, key := range sortedAnyKeys(definitions) {
		out[key] = rv.computedDefinition(definitions[key])
		computed[key] = out[key]
	}
	return out
}

// computedDefinition mirrors the previous iterate_over/fields/key handling while
// running every field value through the bounded resolver. Definitions that are
// a plain map with a fields section (no iterate/operation, e.g. the Weather
// integration's computed.weather) keep their declared shape: fields stay
// nested, as in the reference resolver, so references like
// computed.weather.fields.temperature resolve.
func (rv *computedResolver) computedDefinition(raw any) any {
	def := object(raw)
	if _, hasIterate := def["iterate_over"]; !hasIterate {
		if _, hasFields := def["fields"]; hasFields && strings.TrimSpace(stringValue(def["operation"])) == "" {
			return rv.resolve(def, 1)
		}
	}
	iterate := strings.TrimSpace(stringValue(def["iterate_over"]))
	rows := []any{}
	if iterate != "" {
		rows = listValue(rv.walkScopePath(iterate, 1))
	} else {
		rows = []any{map[string]any{}}
	}
	out := []any{}
	for index, row := range rows {
		fields := object(def["fields"])
		scope := &computedResolver{root: rv.root, env: rv.env, endpoints: rv.endpoints, item: object(row), index: index}
		mapped := make(map[string]any, len(fields)+1)
		for _, field := range sortedAnyKeys(fields) {
			mapped[field] = scope.resolve(fields[field], 1)
		}
		if keyTemplate := stringValue(def["key"]); keyTemplate != "" {
			keyValue, _ := interpolate(keyTemplate, rv.env, rv.endpoints)
			mapped["id"] = keyValue
		}
		out = append(out, mapped)
	}
	if iterate == "" && len(out) == 1 {
		return out[0]
	}
	return out
}

func (rv *computedResolver) cloneScope(inputs map[string]any) computedResolver {
	return computedResolver{root: rv.root, env: rv.env, endpoints: rv.endpoints, item: rv.item, index: rv.index, scope: inputs}
}

func (rv *computedResolver) resolve(value any, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	switch v := value.(type) {
	case string:
		return rv.resolveString(v, depth+1)
	case nil:
		return nil
	case []any:
		out := make([]any, len(v))
		for i, entry := range v {
			out[i] = rv.resolve(entry, depth+1)
		}
		return out
	case map[string]any:
		operation := strings.ToLower(strings.TrimSpace(stringValue(v["operation"])))
		if operation != "" {
			return rv.resolveOperation(v, operation, depth+1)
		}
		if hasConditionalShape(v) {
			return rv.resolveIf(v, depth+1)
		}
		out := make(map[string]any, len(v))
		for key, entry := range v {
			out[key] = rv.resolve(entry, depth+1)
		}
		return out
	default:
		return value
	}
}

func (rv *computedResolver) resolveString(text string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	value := text
	if strings.Contains(value, "${") {
		// A string made of a single placeholder keeps its resolved type so
		// numbers, booleans and objects are not stringified.
		if resolved, ok := rv.resolveSingletonPlaceholder(text, depth+1); ok {
			return resolved
		}
		value = rv.interpolateTemplate(value, depth+1)
	}
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	if scopedPathText(trimmed) {
		if found := rv.walkScopePath(trimmed, depth+1); found != nil {
			return found
		}
	}

	// Inline conditional values such as if(UNIT == 'f', '°F', '°C').
	if inlineIfPattern.MatchString(trimmed) {
		if result, err := evaluateScalarExpression(rv.interpolateTemplate(trimmed, depth+1), rv, depth+1); err == nil {
			return result
		}
	}

	if found, ok := rv.lookupScopeValue(trimmed, depth+1); ok && found != nil {
		return found
	}
	return trimmed
}

// resolveSingletonPlaceholder resolves strings where the entire value is one
// placeholder so non-string values survive, as in "${computed.weather.fields.hourly}".
func (rv *computedResolver) resolveSingletonPlaceholder(text string, depth int) (any, bool) {
	if depth > maxComputedDepth {
		return nil, false
	}
	trimmed := strings.TrimSpace(text)
	if len(trimmed) < 4 || !strings.HasPrefix(trimmed, "${") || !strings.HasSuffix(trimmed, "}") {
		return nil, false
	}
	inner := strings.TrimSpace(trimmed[2 : len(trimmed)-1])
	if inner == "" || strings.Contains(inner, "${") {
		return nil, false
	}
	if value, ok := rv.envLookup(inner); ok {
		return value, true
	}
	if placeholderExpressionLike(inner) {
		if resolved, err := evaluateScalarExpression(rv.interpolateTemplate(inner, depth+1), rv, depth+1); err == nil {
			return resolved, true
		}
	}
	if answer := rv.walkScopePath(inner, depth+1); answer != nil {
		return answer, true
	}
	return nil, false
}

// interpolateTemplate expands ${...} placeholders: environment variables (with
// dotted paths into JSON environment values) first, then bounded scalar
// expressions, then scope paths. Unresolved placeholders expand to "".
func (rv *computedResolver) interpolateTemplate(text string, depth int) string {
	if depth > maxComputedDepth {
		return ""
	}
	result := text
	for pass := 0; pass < 5 && strings.Contains(result, "${"); pass++ {
		replaced := false
		result = templatePattern.ReplaceAllStringFunc(result, func(token string) string {
			replaced = true
			key := strings.TrimSpace(token[2 : len(token)-1])
			if key == "" {
				return ""
			}
			if strings.HasPrefix(key, "now()") {
				return time.Now().UTC().Format("2006-01-02")
			}
			if value, ok := rv.envLookup(key); ok {
				return printable(value)
			}
			if placeholderExpressionLike(key) {
				if resolved, err := evaluateScalarExpression(key, rv, depth+1); err == nil {
					return printable(resolved)
				}
				return ""
			}
			if found := rv.walkScopePath(key, depth+1); found != nil {
				return printable(found)
			}
			return ""
		})
		if !replaced {
			break
		}
	}
	return result
}

// placeholderExpressionLike reports whether a placeholder body is a bounded
// scalar expression instead of a plain path.
func placeholderExpressionLike(text string) bool {
	return inlineIfPattern.MatchString(text) || expressionLikePattern.MatchString(text)
}

var expressionLikePattern = regexp.MustCompile(
	`(?:\bif\s*\(|\bnow\s*\(|\bcontains\b|\b(?:and|or|not)\b|==|!=|>=|<=|\s&&\s|\s\|\|\s)`)

// scopedPathText reports whether text is a scoped reference such as
// this.endpoints.fetch-weather.mappedResponse.current.temperature.
func scopedPathText(text string) bool {
	if strings.HasPrefix(text, "this.") {
		return true
	}
	for _, prefix := range []string{"computed.", "endpoints.", "lookup_tables.", "environment_variables."} {
		if strings.HasPrefix(text, prefix) {
			return true
		}
	}
	return false
}

// resolveOperand resolves an expression identifier against named inputs, then
// environment variables (matching the env precedence the REST interpolate()
// path already uses), then the scope root (endpoints, computed, lookup_tables)
// and the current item. Unresolved names keep their literal spelling, as in the
// reference kit.
func (rv *computedResolver) resolveOperand(name string, depth int) any {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	if value, ok := rv.lookupScopeValue(trimmed, depth+1); ok {
		return value
	}
	if value, ok := rv.envLookup(trimmed); ok {
		return normalizeScopeValue(value)
	}
	return trimmed
}

// lookupScopeValue resolves an identifier without consulting environment
// variables (matching the reference resolver order); placeholders handle env.
func (rv *computedResolver) lookupScopeValue(path string, depth int) (any, bool) {
	if depth > maxComputedDepth {
		return nil, false
	}
	if rv.scope != nil {
		if value, ok := rv.scope[path]; ok {
			return normalizeScopeValue(value), true
		}
	}
	if answer := rv.walkScopePath(path, depth+1); answer != nil {
		return answer, true
	}
	if value, ok := rv.item[path]; ok {
		return normalizeScopeValue(value), true
	}
	if strings.ContainsAny(path, ".[") {
		if answer := rv.walkItemPath(path, depth+1); answer != nil {
			return answer, true
		}
	}
	return nil, false
}

// walkScopePath walks a dotted path with dynamic bracket keys against the
// scope root. Unlike the response-mapping lookupPath it resolves bracket keys
// such as [this.endpoints.fetch-weather.mappedResponse.current.weather_code].
func (rv *computedResolver) walkScopePath(path string, depth int) any {
	return rv.walkPath(rv.root, path, depth)
}

func (rv *computedResolver) walkItemPath(path string, depth int) any {
	return rv.walkPath(rv.item, path, depth)
}

func (rv *computedResolver) walkPath(start any, path string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	trimmed := strings.TrimSpace(path)
	trimmed = strings.TrimPrefix(trimmed, "this.")
	trimmed = strings.TrimPrefix(trimmed, "$.")
	if trimmed == "" {
		return start
	}
	values := []any{start}
	for _, segment := range splitScopePath(trimmed) {
		if strings.TrimSpace(segment) == "" {
			continue
		}
		head, groups := splitPathSegment(segment)
		if head != "" {
			for i := range values {
				values[i] = mapMember(values[i], head)
			}
		}
		for _, group := range groups {
			switch {
			case group == "*":
				next := []any{}
				for _, value := range values {
					next = append(next, listValue(value)...)
				}
				values = next
			case isAllDigits(group):
				index, _ := strconv.Atoi(group)
				for i := range values {
					if list, ok := values[i].([]any); ok && index >= 0 && index < len(list) {
						values[i] = list[index]
					} else {
						values[i] = nil
					}
				}
			default:
				key := rv.resolveBracketKey(group, depth+1)
				for i := range values {
					values[i] = mapMember(values[i], key)
				}
			}
		}
	}
	if len(values) == 1 {
		return values[0]
	}
	return values
}

// splitPathSegment splits "weather_code_map[a.b].c[0]" into the leading key and
// successive bracket groups.
func splitPathSegment(segment string) (string, []string) {
	head := segment
	groups := []string{}
	if index := strings.IndexByte(segment, '['); index >= 0 {
		head = segment[:index]
		rest := segment[index:]
		for strings.HasPrefix(rest, "[") {
			closing := strings.IndexByte(rest, ']')
			if closing < 0 {
				break
			}
			groups = append(groups, strings.TrimSpace(rest[1:closing]))
			rest = rest[closing+1:]
		}
	}
	return head, groups
}

func (rv *computedResolver) resolveBracketKey(raw string, depth int) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if isQuoted(trimmed) {
		return trimmed[1 : len(trimmed)-1]
	}
	if isAllDigits(trimmed) || trimmed == "*" {
		return trimmed
	}
	if resolved := rv.resolveOperand(trimmed, depth); resolved != nil {
		if text := printable(resolved); text != "" && text != trimmed {
			return text
		}
	}
	return trimmed
}

func splitScopePath(path string) []string {
	segments := []string{}
	current := strings.Builder{}
	depth := 0
	for _, char := range path {
		switch char {
		case '[':
			depth++
		case ']':
			if depth > 0 {
				depth--
			}
		case '.':
			if depth == 0 && current.Len() > 0 {
				segments = append(segments, current.String())
				current.Reset()
				continue
			}
		}
		current.WriteRune(char)
	}
	if current.Len() > 0 {
		segments = append(segments, current.String())
	}
	return segments
}

func mapMember(current any, key string) any {
	switch container := current.(type) {
	case map[string]any:
		return container[key]
	case map[any]any:
		// yaml.v3 decodes maps with non-string keys (e.g. numeric weather codes)
		// as map[any]any where numeric keys keep their typed value.
		if value, ok := container[key]; ok {
			return value
		}
		if number, ok := numericOf(key); ok && float64(int(number)) == number {
			if value, ok := container[int(number)]; ok {
				return value
			}
		}
		return nil
	default:
		return nil
	}
}

// normalizeValue converts YAML's map[any]any trees into JSON-style
// map[string]any trees so the resolver can also see maps with numeric keys
// (lookup tables keyed by weather codes are the common case).
func normalizeValue(value any) any {
	switch v := value.(type) {
	case map[any]any:
		out := make(map[string]any, len(v))
		for rawKey, entry := range v {
			out[printable(rawKey)] = normalizeValue(entry)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, entry := range v {
			out[key] = normalizeValue(entry)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, entry := range v {
			out[i] = normalizeValue(entry)
		}
		return out
	default:
		return value
	}
}

func isQuoted(text string) bool {
	if len(text) < 2 {
		return false
	}
	return (strings.HasPrefix(text, "'") && strings.HasSuffix(text, "'")) ||
		(strings.HasPrefix(text, "\"") && strings.HasSuffix(text, "\""))
}

func isAllDigits(text string) bool {
	if text == "" {
		return false
	}
	for _, char := range text {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func printable(values any) string {
	switch value := values.(type) {
	case nil:
		return ""
	case string:
		return value
	case bool:
		if value {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	default:
		return fmt.Sprint(value)
	}
}

func (rv *computedResolver) envLookup(key string) (any, bool) {
	if value, ok := rv.env[key]; ok {
		return value, true
	}
	if dot := strings.IndexByte(key, '.'); dot > 0 {
		if value, ok := rv.env[key[:dot]]; ok {
			if parsed, err := decodeJSONValue(value); err == nil {
				if found := lookupPath(parsed, key[dot+1:]); found != nil {
					return found, true
				}
			}
		}
	}
	return nil, false
}

func (rv *computedResolver) resolveOperation(def map[string]any, operation string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	switch operation {
	case "if":
		return rv.resolveIf(def, depth)
	case "lookup", "lookup_table":
		return rv.resolveLookup(def, depth)
	case "expr":
		return rv.resolveExpr(def, depth)
	case "count":
		counted := rv.resolve(def["value"], depth+1)
		values := listValue(counted)
		if values == nil {
			values = listValue(def["value"])
		}
		return len(values)
	case "compute_health", "compute_health_score":
		// Legacy semantics preserved: score from a value/threshold pair.
		input := object(def["inputs"])
		value := numeric(lookupPath(rv.item, stringValue(input["value"])))
		threshold := numeric(input["threshold"])
		if threshold <= 0 {
			return 0
		}
		score := 100 * (1 - value/threshold)
		if score < 0 {
			score = 0
		}
		if score > 100 {
			score = 100
		}
		return score
	default:
		// Unknown operations keep the previous passthrough behavior.
		out := make(map[string]any, len(def))
		for key, child := range def {
			out[key] = rv.resolve(child, depth+1)
		}
		return out
	}
}

func hasConditionalShape(def map[string]any) bool {
	for _, key := range []string{"condition", "test", "then", "else", "and", "or"} {
		if _, ok := def[key]; ok {
			return true
		}
	}
	return false
}

func firstNonNil(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// resolveIf implements the conditional operation: condition (with optional and
// / or groups) selects the then/else branch, which is resolved as a computed
// value of its own (so nested operations such as lookup_table work).
func (rv *computedResolver) resolveIf(def map[string]any, depth int) any {
	condition := rv.evaluateIfCondition(def, depth)
	var branch any
	if condition {
		branch = firstNonNil(def["then"], def["whenTrue"], def["true"], def["valueIfTrue"])
	} else {
		branch = firstNonNil(def["else"], def["whenFalse"], def["false"], def["valueIfFalse"])
	}
	if !hasValue(branch) {
		return rv.resolveFallback(def, depth)
	}
	return rv.resolve(branch, depth+1)
}

func hasValue(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(v) != ""
	default:
		return true
	}
}

func (rv *computedResolver) evaluateIfCondition(def map[string]any, depth int) bool {
	base := rv.evalCondition(firstNonNil(def["condition"], def["test"], def["value"]), depth)
	andResult := rv.evaluateConditionGroup(def["and"], depth, true)
	if _, hasOr := def["or"]; hasOr {
		orResult := rv.evaluateConditionGroup(def["or"], depth, false)
		return (base && andResult) || orResult
	}
	return base && andResult
}

func (rv *computedResolver) evaluateConditionGroup(value any, depth int, defaultValue bool) bool {
	if value == nil {
		return defaultValue
	}
	if list, ok := value.([]any); ok {
		for _, entry := range list {
			if !rv.evalCondition(entry, depth+1) {
				return false
			}
		}
		return true
	}
	return rv.evalCondition(value, depth+1)
}

func (rv *computedResolver) evalCondition(value any, depth int) bool {
	if depth > maxComputedDepth {
		return false
	}
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case float64:
		return !math.IsNaN(v) && v != 0
	case int:
		return v != 0
	case string:
		return rv.evalConditionText(v, depth)
	default:
		return truthy(rv.resolve(value, depth))
	}
}

// evalConditionText mirrors evaluateComputedFilter from the reference kit:
// placeholders are expanded, then the text is parsed as a bounded scalar
// expression. Parse failures yield false.
func (rv *computedResolver) evalConditionText(text string, depth int) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}
	if strings.EqualFold(trimmed, "true") {
		return true
	}
	if strings.EqualFold(trimmed, "false") {
		return false
	}
	if strings.Contains(trimmed, "${") {
		trimmed = strings.TrimSpace(rv.interpolateTemplate(trimmed, depth+1))
		if trimmed == "" {
			return false
		}
		if strings.EqualFold(trimmed, "true") {
			return true
		}
		if strings.EqualFold(trimmed, "false") {
			return false
		}
	}
	result, err := evaluateScalarExpression(trimmed, rv, depth+1)
	if err != nil {
		return false
	}
	return truthy(result)
}

func truthy(value any) bool {
	switch v := value.(type) {
	case nil:
		return false
	case bool:
		return v
	case float64:
		return !math.IsNaN(v) && v != 0
	case int:
		return v != 0
	case string:
		trimmed := strings.TrimSpace(v)
		return trimmed != "" && trimmed != "0"
	default:
		return true
	}
}

// resolveLookup implements lookup/lookup_table: table/key/field with fallback.
func (rv *computedResolver) resolveLookup(def map[string]any, depth int) any {
	tableName := rv.resolve(def["table"], depth+1)
	key := rv.resolve(def["key"], depth+1)
	field, _ := def["field"].(string)
	var table any
	if name, ok := tableName.(string); ok && name != "" {
		normalized := strings.TrimPrefix(strings.TrimSpace(name), "this.")
		table = rv.walkScopePath("lookup_tables."+normalized, depth+1)
		if table == nil {
			table = rv.walkScopePath(normalized, depth+1)
		}
	} else {
		table = tableName
	}
	result := lookupTableValue(table, key, field)
	if result == nil {
		return rv.resolveFallback(def, depth)
	}
	return result
}

// lookupTableValue ports getLookupTableValue: array tables are indexed
// numerically, object tables by string key with a numeric fallback.
func lookupTableValue(table any, key any, field string) any {
	if table == nil || key == nil {
		return nil
	}
	var entry any
	switch t := table.(type) {
	case []any:
		if f, ok := numericOf(key); ok {
			index := int(f)
			if float64(index) == f && index >= 0 && index < len(t) {
				entry = t[index]
			}
		}
	case map[string]any:
		entry, _ = t[printable(key)]
		if entry == nil {
			if f, ok := numericOf(key); ok && float64(int(f)) == f {
				entry, _ = t[strconv.Itoa(int(f))]
			}
		}
	case map[any]any:
		entry = mapMember(t, printable(key))
	default:
		return nil
	}
	if entry == nil {
		return nil
	}
	if strings.TrimSpace(field) != "" {
		return traverseField(entry, field)
	}
	return entry
}

func traverseField(entry any, field string) any {
	current := entry
	for _, token := range splitFieldTokens(field) {
		if token == "" {
			continue
		}
		if strings.HasPrefix(token, "[") && strings.HasSuffix(token, "]") {
			index, _ := strconv.Atoi(strings.Trim(token, "[]"))
			current = accessIndex(current, index)
			continue
		}
		current = mapMember(current, token)
	}
	return current
}

func splitFieldTokens(field string) []string {
	tokens := []string{}
	current := strings.Builder{}
	for i := 0; i < len(field); i++ {
		char := field[i]
		switch {
		case char == '[':
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
			closing := strings.IndexByte(field[i:], ']')
			if closing < 0 {
				return tokens
			}
			tokens = append(tokens, field[i:i+closing+1])
			i += closing
		case char == '.':
			if current.Len() > 0 {
				tokens = append(tokens, current.String())
				current.Reset()
			}
		default:
			current.WriteByte(char)
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

func accessIndex(current any, index int) any {
	values, ok := current.([]any)
	if !ok || index < 0 || index >= len(values) {
		return nil
	}
	return values[index]
}

func (rv *computedResolver) resolveExpr(def map[string]any, depth int) any {
	expression := ""
	if raw, ok := def["expression"].(string); ok {
		expression = raw
	} else if raw, ok := def["value"].(string); ok {
		expression = raw
	}
	if strings.TrimSpace(expression) == "" {
		return rv.resolveFallback(def, depth)
	}
	inputs := map[string]any{}
	for key, rawValue := range object(def["inputs"]) {
		inputs[key] = rv.resolve(rawValue, depth+1)
	}
	scoped := rv.cloneScope(inputs)
	result, err := evaluateScalarExpression(expression, &scoped, depth+1)
	if err != nil || isNotANumber(result) {
		return rv.resolveFallback(def, depth)
	}
	return result
}

func (rv *computedResolver) resolveFallback(def map[string]any, depth int) any {
	if raw, ok := def["fallback"]; ok {
		return rv.resolve(raw, depth+1)
	}
	return nil
}

func isNotANumber(value any) bool {
	f, ok := value.(float64)
	return ok && math.IsNaN(f)
}

// normalizeScopeValue mirrors normalizeMathScopeValue: numeric and boolean
// strings become their scalar forms before comparisons.
func normalizeScopeValue(value any) any {
	switch v := value.(type) {
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return v
		}
		if trimmed == "true" {
			return true
		}
		if trimmed == "false" {
			return false
		}
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return f
		}
		return v
	default:
		return value
	}
}

func sortedAnyKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// ---------------------------------------------------------------------------
// Bounded scalar expression engine. Tokens are numbers, quoted strings,
// identifiers (including dotted and bracketed paths), operators (comparison,
// and/or/not, contains, + - * /), parentheses and commas. The single supported
// function form is if(cond, a, b); unsupported syntax fails closed.
// ---------------------------------------------------------------------------

type tokenKind int

const (
	tokenNumber tokenKind = iota
	tokenString
	tokenIdentifier
	tokenOperator
	tokenParen
	tokenComma
	tokenEOF
)

type expressionToken struct {
	kind tokenKind
	text string
	num  float64
}

var operatorBreakChars = " ()><=!&|-,*"

func evaluateScalarExpression(expression string, rv *computedResolver, depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	tokens, err := lexExpression(expression)
	if err != nil {
		return nil, err
	}
	parser := &expressionParser{tokens: tokens, resolver: rv}
	result, err := parser.parseOr(depth + 1)
	if err != nil {
		return nil, err
	}
	if token := parser.peek(); token.kind != tokenEOF {
		return nil, errors.New("unexpected trailing tokens in expression")
	}
	if number, ok := result.(float64); ok && math.IsNaN(number) {
		return nil, errors.New("expression evaluated to NaN")
	}
	return result, nil
}

func isWhitespaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\r' || c == '\n'
}

func isDigitByte(c byte) bool {
	return c >= '0' && c <= '9'
}

func isLetterByte(c byte) bool {
	return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

func isIdentStartByte(c byte) bool {
	return isLetterByte(c) || c == '_' || c == '$'
}

// lexExpression tokenizes a scalar expression. Identifiers keep dashes that are
// attached to a following letter so endpoint ids like fetch-weather stay whole.
func lexExpression(input string) ([]expressionToken, error) {
	tokens := []expressionToken{}
	push := func(token expressionToken) error {
		if len(tokens) >= maxExpressionTokens {
			return errors.New("expression exceeds token limit")
		}
		tokens = append(tokens, token)
		return nil
	}
	twoChar := func(index int) (string, bool) {
		if index+1 >= len(input) {
			return "", false
		}
		pair := input[index : index+2]
		switch pair {
		case ">=", "<=", "==", "!=", "&&", "||":
			return pair, true
		}
		return "", false
	}
	for i := 0; i < len(input); {
		c := input[i]
		switch {
		case isWhitespaceByte(c):
			i++
		case c == '-' && i+1 < len(input) && isDigitByte(input[i+1]):
			end := i + 2
			for end < len(input) && (isDigitByte(input[end]) || input[end] == '.') {
				end++
			}
			number, err := strconv.ParseFloat(input[i:end], 64)
			if err != nil {
				return nil, fmt.Errorf("invalid number %q in expression", input[i:end])
			}
			if err := push(expressionToken{kind: tokenNumber, text: input[i:end], num: number}); err != nil {
				return nil, err
			}
			i = end
		case isIdentStartByte(c):
			end := i + 1
			for end < len(input) {
				char := input[end]
				if char == '-' {
					if end+1 < len(input) && isLetterByte(input[end+1]) {
						end++
						continue
					}
					break
				}
				if isWhitespaceByte(char) || strings.IndexByte(operatorBreakChars, char) >= 0 {
					break
				}
				end++
			}
			raw := input[i:end]
			switch strings.ToLower(raw) {
			case "and", "or", "not", "contains":
				if err := push(expressionToken{kind: tokenOperator, text: strings.ToLower(raw)}); err != nil {
					return nil, err
				}
			default:
				if err := push(expressionToken{kind: tokenIdentifier, text: raw}); err != nil {
					return nil, err
				}
			}
			i = end
		case c == '(' || c == ')':
			if err := push(expressionToken{kind: tokenParen, text: string(c)}); err != nil {
				return nil, err
			}
			i++
		case c == ',':
			if err := push(expressionToken{kind: tokenComma, text: ","}); err != nil {
				return nil, err
			}
			i++
		case c == '\'':
			text, next, ok := lexQuoted(input, i)
			if !ok {
				return nil, errors.New("unterminated string in expression")
			}
			if err := push(expressionToken{kind: tokenString, text: text}); err != nil {
				return nil, err
			}
			i = next
		case c == '"':
			text, next, ok := lexQuoted(input, i)
			if !ok {
				return nil, errors.New("unterminated string in expression")
			}
			if err := push(expressionToken{kind: tokenString, text: text}); err != nil {
				return nil, err
			}
			i = next
		case isDigitByte(c):
			end := i
			for end < len(input) && (isDigitByte(input[end]) || input[end] == '.') {
				end++
			}
			number, err := strconv.ParseFloat(input[i:end], 64)
			if err != nil {
				return nil, fmt.Errorf("invalid number %q in expression", input[i:end])
			}
			if err := push(expressionToken{kind: tokenNumber, text: input[i:end], num: number}); err != nil {
				return nil, err
			}
			i = end
		default:
			if pair, ok := twoChar(i); ok {
				if err := push(expressionToken{kind: tokenOperator, text: pair}); err != nil {
					return nil, err
				}
				i += 2
				continue
			}
			switch c {
			case '>', '<', '+', '-', '*', '/', '!':
				if err := push(expressionToken{kind: tokenOperator, text: string(c)}); err != nil {
					return nil, err
				}
				i++
			default:
				return nil, fmt.Errorf("unsupported character %q in expression", string(c))
			}
		}
	}
	tokens = append(tokens, expressionToken{kind: tokenEOF})
	return tokens, nil
}

func lexQuoted(input string, start int) (string, int, bool) {
	quote := input[start]
	var text strings.Builder
	i := start + 1
	for i < len(input) {
		char := input[i]
		if char == '\\' && i+1 < len(input) {
			text.WriteByte(input[i+1])
			i += 2
			continue
		}
		if char == quote {
			return text.String(), i + 1, true
		}
		text.WriteByte(char)
		i++
	}
	return text.String(), len(input), false
}

type expressionParser struct {
	tokens   []expressionToken
	position int
	resolver *computedResolver
}

func (p *expressionParser) peek() expressionToken {
	if p.position < len(p.tokens) {
		return p.tokens[p.position]
	}
	return expressionToken{kind: tokenEOF}
}

// next returns the current token and advances, except at the EOF sentinel.
func (p *expressionParser) next() expressionToken {
	token := p.peek()
	if token.kind != tokenEOF {
		p.position++
	}
	return token
}

func (p *expressionParser) parseOr(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	left, err := p.parseAnd(depth)
	if err != nil {
		return nil, err
	}
	for {
		token := p.peek()
		if token.kind != tokenOperator || (token.text != "or" && token.text != "||") {
			return left, nil
		}
		p.next()
		right, err := p.parseAnd(depth)
		if err != nil {
			return nil, err
		}
		left = truthy(left) || truthy(right)
	}
}

func (p *expressionParser) parseAnd(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	left, err := p.parseNot(depth)
	if err != nil {
		return nil, err
	}
	for {
		token := p.peek()
		if token.kind != tokenOperator || (token.text != "and" && token.text != "&&") {
			return left, nil
		}
		p.next()
		right, err := p.parseNot(depth)
		if err != nil {
			return nil, err
		}
		left = truthy(left) && truthy(right)
	}
}

func (p *expressionParser) parseNot(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	token := p.peek()
	if token.kind == tokenOperator && (token.text == "not" || token.text == "!") {
		p.next()
		value, err := p.parseNot(depth)
		if err != nil {
			return nil, err
		}
		return !truthy(value), nil
	}
	return p.parseComparison(depth)
}

func (p *expressionParser) parseComparison(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	left, err := p.parseAdditive(depth)
	if err != nil {
		return nil, err
	}
	for {
		token := p.peek()
		if token.kind != tokenOperator {
			return left, nil
		}
		switch token.text {
		case "contains":
			p.next()
			right, err := p.parseAdditive(depth)
			if err != nil {
				return nil, err
			}
			left = strings.Contains(strings.ToLower(printable(left)), strings.ToLower(printable(right)))
		case ">", "<", ">=", "<=", "==", "!=":
			p.next()
			right, err := p.parseAdditive(depth)
			if err != nil {
				return nil, err
			}
			left = compareValues(left, right, token.text)
		default:
			return left, nil
		}
	}
}

func (p *expressionParser) parseAdditive(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	left, err := p.parseMultiplicative(depth)
	if err != nil {
		return nil, err
	}
	for {
		token := p.peek()
		if token.kind != tokenOperator || (token.text != "+" && token.text != "-") {
			return left, nil
		}
		operator := token.text
		p.next()
		right, err := p.parseMultiplicative(depth)
		if err != nil {
			return nil, err
		}
		if operator == "+" {
			left = toNumber(left) + toNumber(right)
		} else {
			left = toNumber(left) - toNumber(right)
		}
	}
}

func (p *expressionParser) parseMultiplicative(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	left, err := p.parsePrimary(depth)
	if err != nil {
		return nil, err
	}
	for {
		token := p.peek()
		if token.kind != tokenOperator || (token.text != "*" && token.text != "/") {
			return left, nil
		}
		operator := token.text
		p.next()
		right, err := p.parsePrimary(depth)
		if err != nil {
			return nil, err
		}
		if operator == "*" {
			left = toNumber(left) * toNumber(right)
		} else {
			left = toNumber(left) / toNumber(right)
		}
	}
}

// parsePrimary checks nesting depth before any recursion into a parenthesized
// subexpression or an if() call; sibling grammar levels share the parser depth.
func (p *expressionParser) parsePrimary(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	token := p.next()
	switch token.kind {
	case tokenNumber:
		return token.num, nil
	case tokenString:
		return token.text, nil
	case tokenIdentifier:
		switch strings.ToLower(token.text) {
		case "true":
			return true, nil
		case "false":
			return false, nil
		case "null":
			return nil, nil
		}
		if opener := p.peek(); opener.kind == tokenParen && opener.text == "(" {
			switch strings.ToLower(token.text) {
			case "if":
				return p.parseIfCall(depth + 1)
			case "now":
				p.next()
				if closer := p.next(); closer.kind != tokenParen || closer.text != ")" {
					return nil, errors.New("now() takes no arguments")
				}
				return float64(time.Now().UnixMilli()), nil
			default:
				return nil, fmt.Errorf("function %q is not supported", token.text)
			}
		}
		return p.resolver.resolveOperand(token.text, depth), nil
	case tokenParen:
		if token.text != "(" {
			return nil, errors.New("unexpected ) in expression")
		}
		value, err := p.parseOr(depth + 1)
		if err != nil {
			return nil, err
		}
		if closer := p.next(); closer.kind != tokenParen || closer.text != ")" {
			return nil, errors.New("unbalanced parentheses in expression")
		}
		return value, nil
	default:
		return nil, errors.New("unexpected token in expression")
	}
}

// parseIfCall consumes if(cond, a, b) branches eagerly (the grammar is
// side-effect free) and returns the branch value the condition selects.
func (p *expressionParser) parseIfCall(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	p.next() // consume "("
	condition, err := p.parseOr(depth)
	if err != nil {
		return nil, err
	}
	if token := p.next(); token.kind != tokenComma {
		return nil, errors.New("if() requires three comma-separated arguments")
	}
	whenTrue, err := p.parseOr(depth)
	if err != nil {
		return nil, err
	}
	if token := p.next(); token.kind != tokenComma {
		return nil, errors.New("if() requires three comma-separated arguments")
	}
	whenFalse, err := p.parseOr(depth)
	if err != nil {
		return nil, err
	}
	if token := p.next(); token.kind != tokenParen || token.text != ")" {
		return nil, errors.New("unbalanced parentheses in expression")
	}
	if truthy(condition) {
		return whenTrue, nil
	}
	return whenFalse, nil
}

func compareValues(left, right any, operator string) bool {
	a := coerceComparable(left)
	b := coerceComparable(right)
	an, aIsNumber := a.(float64)
	bn, bIsNumber := b.(float64)
	if aIsNumber && bIsNumber {
		return compareOrdered(an, bn, operator)
	}
	as, aIsText := a.(string)
	bs, bIsText := b.(string)
	if aIsText && bIsText {
		switch operator {
		case "==":
			return as == bs
		case "!=":
			return as != bs
		case ">":
			return as > bs
		case "<":
			return as < bs
		case ">=":
			return as >= bs
		case "<=":
			return as <= bs
		}
		return false
	}
	// Unlike types: JS equality is false, inequality true, ordering false.
	switch operator {
	case "==":
		return false
	case "!=":
		return true
	}
	return false
}

func compareOrdered(a, b float64, operator string) bool {
	switch operator {
	case ">":
		return a > b
	case "<":
		return a < b
	case ">=":
		return a >= b
	case "<=":
		return a <= b
	case "!=":
		return a != b
	default:
		return a == b
	}
}

func coerceComparable(value any) any {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case bool:
		if v {
			return 1.0
		}
		return 0.0
	case nil:
		return nil
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0.0
		}
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return f
		}
		if parsed, ok := parseTimestamp(trimmed); ok {
			return float64(parsed.UnixMilli())
		}
		return trimmed
	default:
		return value
	}
}

func numericOf(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	case bool:
		if v {
			return 1, true
		}
		return 0, true
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

func toNumber(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case bool:
		if v {
			return 1
		}
		return 0
	case nil:
		return 0
	case string:
		trimmed := strings.TrimSpace(v)
		if trimmed == "" {
			return 0
		}
		if f, err := strconv.ParseFloat(trimmed, 64); err == nil {
			return f
		}
		return math.NaN()
	default:
		return math.NaN()
	}
}

func parseTimestamp(value string) (time.Time, bool) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02T15:04:05.000",
		"2006-01-02T15:04",
		"2006-01-02 15:04:05",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}
