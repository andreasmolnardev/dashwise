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
	// maxIterateRows caps list/object walks for expand/iterate/filter so a
	// huge lookup table cannot turn a definition into unbounded work.
	maxIterateRows = 1000
	// maxTemplatePasses bounds innermost-first ${...} placeholder resolution.
	maxTemplatePasses = 10
)

var inlineIfPattern = regexp.MustCompile(`^if\s*\((.*)\)$`)

// iterateAliasPattern splits "this.endpoints.X.mappedResponse.systems as system".
var iterateAliasPattern = regexp.MustCompile(`^(.*)\s+as\s+([A-Za-z_$][\w$-]*)$`)

// prefixIndexPattern treats non-numeric indexes like "0.used_bytes" by their
// leading array position (dashdot's ${_index}.used_bytes index_lookup).
var prefixIndexPattern = regexp.MustCompile(`^(\d+)\s*(?:\.|$|\[)`)

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
	// indexSet marks that index values are the ${_index} of an iteration; it
	// distinguishes "not iterating" (false) from literal row index 0 (true).
	indexSet bool
	// currentField names the field being resolved so accumulating iterations
	// (initial_value + from: <alias>.<field>) can read the running value.
	currentField string
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
		out[key] = rv.computedDefinition(key, definitions[key])
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
func (rv *computedResolver) computedDefinition(name string, raw any) any {
	def := object(raw)
	operation := strings.ToLower(strings.TrimSpace(stringValue(def["operation"])))
	if operation == "expand" && def["on"] != nil {
		return rv.resolveExpandedNode(def, name, 1)
	}
	if _, hasIterate := def["iterate_over"]; hasIterate {
		if _, hasInitial := def["initial_value"]; hasInitial {
			return rv.resolveIteratedNode(def, name, name, 1)
		}
		return rv.resolveIteratedNode(def, name, "", 1)
	}
	if _, hasFields := def["fields"]; hasFields && operation == "" {
		return rv.resolve(def, 1)
	}
	// Declared computations without fields/iteration (count, expr, join, ...)
	// resolve through the operation dispatcher.
	if operation != "" {
		return rv.resolveOperation(def, operation, 1)
	}
	// Legacy single-row shape: keep the previous behavior (fields resolved
	// once against an empty item).
	row := &computedResolver{root: rv.root, env: rv.env, endpoints: rv.endpoints, item: map[string]any{}}
	mapped := map[string]any{}
	for _, field := range sortedAnyKeys(object(def["fields"])) {
		mapped[field] = row.resolve(object(def["fields"])[field], 1)
	}
	if keyTemplate := stringValue(def["key"]); keyTemplate != "" {
		keyValue, _ := interpolate(keyTemplate, rv.env, rv.endpoints)
		mapped["id"] = keyValue
	}
	return mapped
}

func (rv *computedResolver) cloneScope(inputs map[string]any) computedResolver {
	// Expression evaluation (expr/math) runs with the current row context
	// (alias bindings such as "as prop", item, index) plus the declared
	// inputs; inputs shadow same-named bindings.
	merged := rv.copyScope()
	if merged == nil {
		merged = map[string]any{}
	}
	for key, value := range inputs {
		merged[key] = value
	}
	return computedResolver{
		root: rv.root, env: rv.env, endpoints: rv.endpoints,
		item: rv.item, index: rv.index, indexSet: rv.indexSet,
		currentField: rv.currentField, scope: merged,
	}
}

// childResolver builds a bounded row resolver for one iteration entry, sharing
// the scope (named/alias bindings) with the parent and optionally binding an
// iteration alias such as "as system".
func (rv *computedResolver) childResolver(row any, index int, alias string, aliasValue any) *computedResolver {
	child := &computedResolver{
		root: rv.root, env: rv.env, endpoints: rv.endpoints,
		item: object(row), index: index, indexSet: true,
		currentField: rv.currentField,
	}
	if scope := rv.copyScope(); scope != nil {
		child.scope = scope
	} else if alias != "" {
		child.scope = map[string]any{}
	}
	if alias != "" && aliasValue != nil {
		if child.scope == nil {
			child.scope = map[string]any{}
		}
		child.scope[alias] = aliasValue
	}
	return child
}

func (rv *computedResolver) copyScope() map[string]any {
	if rv.scope == nil {
		return nil
	}
	out := make(map[string]any, len(rv.scope)+1)
	for key, value := range rv.scope {
		out[key] = value
	}
	return out
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
		if operation == "expand" && v["on"] != nil {
			return rv.resolveExpandedNode(v, "", depth+1)
		}
		if _, hasIterate := v["iterate_over"]; hasIterate {
			return rv.resolveIteratedNode(v, rv.currentField, "", depth+1)
		}
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

// ---------------------------------------------------------------------------
// Iteration, expansion and reduction. All walks are row-bounded and the
// bounded expression engine evaluates declared filter/condition strings.
// ---------------------------------------------------------------------------

type iterateeEntry struct {
	key   string
	value any
}

// resolveExpandedNode implements operation: expand with on: "<path> as alias",
// optional filter, optional key template and fields resolved per row. Each
// result row starts from the (normalized) item so exported shortcuts and
// widget prototypes can reference both ${name} and ${system.name}; the
// optional iteration alias is exposed as its own row key, and resolved fields
// override item values.
func (rv *computedResolver) resolveExpandedNode(def map[string]any, fieldKey string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	rows, alias := rv.iterateeEntries(def["on"], depth)
	fields := map[string]any{}
	for key, value := range object(def["fields"]) {
		fields[key] = value
	}
	out := make([]any, 0, len(rows))
	for index, row := range rows {
		rowCtx := rv.childResolver(row.value, index, alias, row.value)
		rowCtx.currentField = fieldKey
		if !rv.rowPassesFilter(def["filter"], rowCtx, depth+1) {
			continue
		}
		entry := map[string]any{}
		if itemMap, ok := normalizeValue(row.value).(map[string]any); ok {
			for key, value := range itemMap {
				entry[key] = value
			}
		}
		for _, field := range sortedAnyKeys(fields) {
			// Nested iterated definitions (accums) publish/patch under the
			// field's own name, not the computed block name.
			rowCtx.currentField = field
			entry[field] = rowCtx.resolve(fields[field], depth+1)
		}
		if _, exists := entry[alias]; !exists {
			entry[alias] = row.value
		}
		if keyTemplate := stringValue(def["key"]); keyTemplate != "" {
			if keyValue, ok := keyTemplateString(rowCtx, keyTemplate, depth+1); ok {
				entry["id"] = keyValue
			} else {
				entry["id"] = row.key
			}
		} else if entryKey := resolveIterationKey(row); entryKey != "" {
			entry["id"] = entryKey
		}
		out = append(out, entry)
	}
	return out
}

// resolveIteratedNode handles iterate_over definitions: a projection over the
// rows (fields/mappingProperties or one declared operation per row) or, when
// initial_value is present, a bounded left-fold accumulation like the
// reference kit's resolveIteratedComputedValue.
func (rv *computedResolver) resolveIteratedNode(def map[string]any, fieldKey, publishKey string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	rows, alias := rv.iterateeEntries(def["iterate_over"], depth)
	if len(rows) > maxIterateRows {
		rows = rows[:maxIterateRows]
	}
	if _, hasInitial := def["initial_value"]; hasInitial {
		return rv.foldIterated(def, rows, alias, fieldKey, publishKey, depth)
	}
	return rv.projectIterated(def, rows, alias, depth)
}

// iterateeEntries resolves the iterate source path (with an optional
// "as alias" suffix) into bounded row entries. Non-array/object sources fail
// closed to no rows.
func (rv *computedResolver) iterateeEntries(raw any, depth int) ([]iterateeEntry, string) {
	if depth > maxComputedDepth {
		return nil, ""
	}
	path, alias := "", ""
	if rawText, ok := raw.(string); ok {
		trimmed := strings.TrimSpace(rawText)
		if match := iterateAliasPattern.FindStringSubmatch(trimmed); match != nil {
			path, alias = strings.TrimSpace(match[1]), match[2]
		} else {
			path = trimmed
		}
	} else {
		return iterateeList(rv.resolve(raw, depth+1)), ""
	}
	if path == "" {
		return nil, alias
	}
	return iterateeList(rv.resolveString(path, depth+1)), alias
}

func iterateeList(value any) []iterateeEntry {
	value = normalizeValue(value)
	switch entries := value.(type) {
	case []any:
		out := make([]iterateeEntry, 0, len(entries))
		for index, entry := range entries {
			out = append(out, iterateeEntry{key: strconv.Itoa(index), value: entry})
		}
		return out
	case map[string]any:
		out := make([]iterateeEntry, 0, len(entries))
		for _, key := range sortedAnyKeys(entries) {
			out = append(out, iterateeEntry{key: key, value: entries[key]})
		}
		return out
	default:
		return nil
	}
}

func resolveIterationKey(row iterateeEntry) string {
	if item, ok := row.value.(map[string]any); ok {
		if id, ok := item["id"]; ok {
			if text := printable(id); text != "" {
				return text
			}
		}
	}
	return row.key
}

// rowPassesFilter evaluates a declared filter string (or boolean) per row.
// Missing or unparsable filters fail closed as "not skipped" only when there
// is no filter at all.
func (rv *computedResolver) rowPassesFilter(filterValue any, rowCtx *computedResolver, depth int) bool {
	if filterValue == nil {
		return true
	}
	if condition, ok := filterValue.(bool); ok {
		return condition
	}
	return rowCtx.evalCondition(filterValue, depth)
}

func keyTemplateString(rowCtx *computedResolver, template string, depth int) (string, bool) {
	if resolved := rowCtx.resolveString(template, depth); resolved != nil {
		if text := strings.TrimSpace(printable(resolved)); text != "" {
			return text, true
		}
	}
	return "", false
}

// projectIterated resolves the rows of an iterate_over definition. When the
// definition declares fields (or mappingProperties, its REST-mapping alias)
// each row maps the declared shape with ${_index} bound to the row position;
// when it declares top-level operations (e.g. beszel's health/warnings) the
// operation result per non-empty row is collected into a list.
func (rv *computedResolver) projectIterated(def map[string]any, rows []iterateeEntry, alias string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	if _, hasInitial := def["initial_value"]; hasInitial {
		return rv.foldIterated(def, rows, alias, rv.currentField, "", depth)
	}
	fields := map[string]any{}
	for key, value := range object(def["fields"]) {
		fields[key] = value
	}
	for key, value := range object(def["mappingProperties"]) {
		fields[key] = value
	}
	operation := strings.TrimSpace(stringValue(def["operation"]))
	out := []any{}
	for index, row := range rows {
		rowCtx := rv.childResolver(row.value, index, alias, row.value)
		if !rv.rowPassesFilter(def["filter"], rowCtx, depth+1) {
			continue
		}
		if operation != "" {
			resolved := rowCtx.resolve(reductionDefinition(def), depth+1)
			if filtered := collectResult(resolved); filtered != nil {
				out = append(out, filtered)
			}
			continue
		}
		rowCtx.currentField = ""
		mapped := map[string]any{}
		for _, field := range sortedAnyKeys(fields) {
			mapped[field] = rowCtx.resolve(fields[field], depth+1)
		}
		if keyTemplate := stringValue(def["key"]); keyTemplate != "" {
			if keyValue, ok := keyTemplateString(rowCtx, keyTemplate, depth+1); ok {
				mapped["id"] = keyValue
			} else {
				mapped["id"] = resolveIterationKey(row)
			}
		} else if entryKey := resolveIterationKey(row); entryKey != "" {
			mapped["id"] = entryKey
		}
		out = append(out, mapped)
	}
	return out
}

// collectResult drops nil and empty-string (+NaN) operation results from
// projection rows so failed evaluations do not emit placeholders.
func collectResult(value any) any {
	switch v := value.(type) {
	case nil:
		return nil
	case string:
		if strings.TrimSpace(v) == "" {
			return nil
		}
		return v
	case float64:
		if math.IsNaN(v) {
			return nil
		}
		return v
	default:
		return v
	}
}

// reductionDefinition strips iteration-control keys so the per-row resolve
// cannot re-enter the iterator (bounded, terminates).
func reductionDefinition(def map[string]any) map[string]any {
	reduction := map[string]any{}
	for key, value := range def {
		switch key {
		case "iterate_over", "initial_value", "filter", "key":
			continue
		}
		reduction[key] = value
	}
	return reduction
}

// foldIterated runs the reference reduce semantics: for every filtered row the
// reduction definition (def minus iterate_over/initial_value/filter) is
// evaluated in row context. Accumulator aliases are patched with the running
// value under the field name before each row (so "from: system.health" style
// operands read the current value), and top-level accumulators are additionally
// published on the root computed map so "from: computed.<key>" operands work.
func (rv *computedResolver) foldIterated(def map[string]any, rows []iterateeEntry, alias, fieldKey, publishKey string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	acc := rv.resolve(def["initial_value"], depth+1)
	if publishKey != "" {
		object(rv.root["computed"])[publishKey] = acc
	}
	reduction := reductionDefinition(def)
	for _, row := range rows {
		rowCtx := rv.childResolver(row.value, 0, alias, row.value)
		rowCtx.currentField = fieldKey
		if !rv.rowPassesFilter(def["filter"], rowCtx, depth+1) {
			continue
		}
		if fieldKey != "" {
			patchAccumulatorAliases(rowCtx.scope, fieldKey, acc)
		}
		next := rowCtx.resolve(reduction, depth+1)
		if next != nil && !isNotANumber(next) {
			acc = next
			if publishKey != "" {
				object(rv.root["computed"])[publishKey] = acc
			}
		}
	}
	return acc
}

// patchAccumulatorAliases mirrors the reference accumulator patching: every
// plain-object alias binding gets the running accumulator under the field
// name, so "from: system.health" style operands see the current value.
func patchAccumulatorAliases(scope map[string]any, field string, acc any) {
	if scope == nil || field == "" {
		return
	}
	for name, value := range scope {
		item, ok := normalizeValue(value).(map[string]any)
		if !ok {
			continue
		}
		patched := make(map[string]any, len(item)+1)
		for key, entry := range item {
			patched[key] = entry
		}
		patched[field] = acc
		scope[name] = patched
	}
}

// resolveString resolves scalar configuration text: placeholders first, then
// scoped paths, inline conditionals, and finally literal fallback.
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
	if answer, ok := rv.lookupScopeValue(inner, depth+1); ok && answer != nil {
		return answer, true
	}
	return nil, false
}

// nestedTemplatePattern matches ${...} placeholders whose body contains no
// nested ${ or } characters. Resolving innermost placeholders first (with
// bounded passes) expands tokens like ${system[${prop.property}]}.
var nestedTemplatePattern = regexp.MustCompile(`\$\{([^${}]*)\}`)

// interpolateTemplate expands ${...} placeholders: environment variables (with
// dotted paths into JSON environment values) first, then bounded scalar
// expressions, then alias/scope/item paths. Unresolved placeholders expand to
// "".
func (rv *computedResolver) interpolateTemplate(text string, depth int) string {
	if depth > maxComputedDepth {
		return ""
	}
	result := text
	if rv.indexSet {
		result = strings.ReplaceAll(result, "${_index}", strconv.Itoa(rv.index))
	}
	for pass := 0; pass < maxTemplatePasses && strings.Contains(result, "${"); pass++ {
		replaced := false
		result = nestedTemplatePattern.ReplaceAllStringFunc(result, func(token string) string {
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
			if found, ok := rv.lookupScopeValue(key, depth+1); ok && found != nil {
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
// It consults named/alias bindings (e.g. "as system"), then the scope root
// (endpoints, computed, lookup_tables), then the current item.
func (rv *computedResolver) lookupScopeValue(path string, depth int) (any, bool) {
	if depth > maxComputedDepth {
		return nil, false
	}
	if rv.scope != nil {
		if value, ok := rv.scope[path]; ok {
			return normalizeScopeValue(value), true
		}
		found, ok := rv.lookupAliasPrefix(path, depth+1)
		if ok {
			return found, true
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

// lookupAliasPrefix resolves dotted or bracketed paths against alias bindings
// such as system.info.status or system[metric.property]. Longest binding match
// wins (bound names are sorted) and missing values fail closed.
func (rv *computedResolver) lookupAliasPrefix(path string, depth int) (any, bool) {
	if depth > maxComputedDepth || len(rv.scope) == 0 {
		return nil, false
	}
	for _, name := range sortedAnyKeys(rv.scope) {
		if name == "" || !strings.HasPrefix(path, name) {
			continue
		}
		suffix := path[len(name):]
		for _, separator := range []string{".", "["} {
			if !strings.HasPrefix(suffix, separator) {
				continue
			}
			// walkPath expects segment boundaries without the leading dot;
			// bracket suffixes ("[metric.property]") are handled natively.
			walked := rv.walkPath(rv.scope[name], strings.TrimPrefix(suffix, "."), depth)
			if walked != nil {
				return normalizeScopeValue(walked), true
			}
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
		segment = strings.TrimLeft(segment, ".")
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
					next = append(next, listValue(normalizeValue(value))...)
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
				for i := range values {
					values[i] = rv.resolveBracketMember(values[i], group, depth+1)
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

// resolveBracketMember applies one dynamic bracket group to a container.
// Literal and quoted keys are tried first, then the group text resolved as
// an operand (so server[metric.property] uses the metric row's property
// value as the key), and finally the group text is walked as a path into the
// container (so system[usage.cpu_usage_percent] resolves nested properties).
// Everything fails closed to nil.
func (rv *computedResolver) resolveBracketMember(container any, raw string, depth int) any {
	if depth > maxComputedDepth {
		return nil
	}
	text := strings.TrimSpace(raw)
	if container == nil || text == "" {
		return nil
	}
	if isQuoted(text) {
		if value, ok := container.(map[string]any); ok {
			return value[text[1:len(text)-1]]
		}
		return nil
	}
	if isAllDigits(text) {
		if list, ok := container.([]any); ok {
			index, _ := strconv.Atoi(text)
			return accessIndex(list, index)
		}
	}
	if strings.Contains(text, "${") {
		text = rv.interpolateTemplate(text, depth+1)
		if text == "" {
			return nil
		}
	}
	if direct := mapMember(container, text); direct != nil {
		return direct
	}
	if resolved := rv.resolveOperand(text, depth); resolved != nil {
		if key := printable(resolved); key != "" && key != text {
			if direct := mapMember(container, key); direct != nil {
				return direct
			}
		}
	}
	if strings.ContainsAny(text, ".[") {
		walked := rv.walkPath(container, text, depth+1)
		if walked != nil {
			return walked
		}
	}
	return nil
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
	if strings.Contains(trimmed, "${") {
		trimmed = strings.TrimSpace(rv.interpolateTemplate(trimmed, depth+1))
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
	case "expr", "evaluate":
		return rv.resolveExpr(def, depth)
	case "math":
		return rv.resolveMath(def, depth)
	case "join":
		return rv.resolveJoin(def, depth)
	case "avg", "coalesce", "human_bytes", "index_lookup", "stringadd":
		return rv.resolveSimpleOperation(def, operation, depth)
	case "count":
		return rv.resolveCount(def, depth)
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
	} else if raw, ok := def["value"]; ok {
		expression = strings.TrimSpace(printable(rv.resolve(raw, depth+1)))
	}
	if strings.TrimSpace(expression) == "" {
		return rv.resolveFallback(def, depth)
	}
	inputs := map[string]any{}
	for key, rawValue := range object(def["inputs"]) {
		inputs[key] = rv.resolve(rawValue, depth+1)
	}
	scoped := rv.cloneScope(inputs)
	evaluation := expression
	if strings.Contains(evaluation, "${") {
		evaluation = rv.interpolateTemplate(evaluation, depth+1)
	}
	result, err := evaluateScalarExpression(evaluation, &scoped, depth+1)
	if err != nil || isNotANumber(result) {
		return rv.resolveFallback(def, depth)
	}
	return result
}

// resolveMath implements the math operation. An explicit expression (or value
// string) is evaluated with declared inputs in scope, including the bounded
// helper functions round/clamp/length/isNaN/humanBytes and ternary branches
// that math.js enabled in the reference runtime. The declarative
// from/subtract/add/to forms build a bounded additive expression instead.
// Failures fail closed to fallback (nil when undeclared).
func (rv *computedResolver) resolveMath(def map[string]any, depth int) any {
	fallback := rv.resolveFallback(def, depth)
	inputs := map[string]any{}
	for key, rawValue := range object(def["inputs"]) {
		inputs[key] = rv.resolve(rawValue, depth+1)
	}
	scoped := rv.cloneScope(inputs)
	evaluate := func(text string) any {
		if strings.Contains(text, "${") {
			text = rv.interpolateTemplate(text, depth+1)
		}
		result, err := evaluateScalarExpression(text, &scoped, depth+1)
		if err != nil || isNotANumber(result) {
			return fallback
		}
		return result
	}
	if explicit, ok := def["expression"].(string); ok {
		return evaluate(explicit)
	}
	if explicit, ok := def["value"].(string); ok {
		return evaluate(explicit)
	}
	from := firstNonNil(def["from"], def["base"], def["left"])
	var operand any
	operator := ""
	if raw := firstNonNil(def["subtract"], def["susbtract"], def["minus"], def["to"]); raw != nil && from != nil {
		operand, operator = raw, "-"
	} else if raw := firstNonNil(def["add"], def["plus"]); raw != nil && from != nil {
		operand, operator = raw, "+"
	}
	if operand == nil {
		return fallback
	}
	fromText := mathOperandText(rv, from, depth+1)
	operandText := mathOperandText(rv, operand, depth+1)
	if fromText == "" || operandText == "" {
		return fallback
	}
	return evaluate("(" + fromText + ") " + operator + " (" + operandText + ")")
}

// mathOperandText turns a declarative operand into expression text: template
// strings and path payloads stay textual so the bounded engine resolves them,
// resolved numbers print numerically, and anything else fails closed to "".
func mathOperandText(rv *computedResolver, value any, depth int) string {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text)
	}
	resolved := rv.resolve(value, depth)
	if resolved == nil {
		return "0"
	}
	return strings.TrimSpace(printable(resolved))
}

// resolveJoin flattens the declared value, maps optional human_bytes
// transforms per entry (dashdot's transform: "human_bytes(value)"), skips
// empty entries and joins with the declared separator (", " by default).
func (rv *computedResolver) resolveJoin(def map[string]any, depth int) any {
	raw := rv.resolve(def["value"], depth)
	separator := ", "
	if text, ok := def["separator"].(string); ok {
		separator = text
	}
	entries := []any{}
	if raw != nil {
		entries = append(entries, raw)
	}
	entries = flattenListValues(entries)
	humanize := false
	if transform, ok := def["transform"].(string); ok {
		text := strings.ToLower(strings.TrimSpace(transform))
		humanize = strings.Contains(text, "human_bytes") || strings.Contains(text, "humanbytes")
	}
	parts := make([]string, 0, len(entries))
	for _, entry := range entries {
		text := ""
		if humanize {
			text = humanBytes(entry)
		} else if entry != nil {
			text = printable(entry)
		}
		if strings.TrimSpace(text) != "" {
			parts = append(parts, text)
		}
	}
	joined := strings.Join(parts, separator)
	if joined == "" {
		return rv.resolveFallback(def, depth)
	}
	return joined
}

// resolveSimpleOperation handles the scalar operations shipped in bundle YAML:
// coalesce (first usable field), avg (numeric mean with optional transform),
// human_bytes, index_lookup and stringadd. Each fails closed to fallback.
func (rv *computedResolver) resolveSimpleOperation(def map[string]any, operation string, depth int) any {
	fallback := rv.resolveFallback(def, depth)
	switch operation {
	case "coalesce":
		fields := listValue(def["fields"])
		if len(fields) == 0 {
			if single, ok := def["field"].(string); ok {
				fields = []any{single}
			}
		}
		for _, rawField := range fields {
			resolved := rv.resolve(rawField, depth+1)
			switch value := resolved.(type) {
			case nil:
				continue
			case string:
				if strings.TrimSpace(value) == "" {
					continue
				}
				return value
			default:
				return resolved
			}
		}
		return fallback
	case "avg":
		source := firstNonNil(def["field"], def["value"])
		values := flattenListValues(listValue(rv.resolve(source, depth+1)))
		numerics := []float64{}
		for _, entry := range values {
			if number, ok := numericOf(entry); ok && !math.IsNaN(number) {
				numerics = append(numerics, number)
			}
		}
		if len(numerics) == 0 {
			return fallback
		}
		sum := 0.0
		for _, number := range numerics {
			sum += number
		}
		mean := sum / float64(len(numerics))
		if transform, ok := def["transform"].(string); ok && strings.TrimSpace(transform) != "" {
			if applied, err := rv.applyValueTransform(transform, mean, depth+1); err == nil && applied != nil && !isNotANumber(applied) {
				return applied
			}
		}
		return mean
	case "human_bytes":
		text := humanBytes(rv.resolve(firstNonNil(def["value"], def["field"]), depth+1))
		if text == "" {
			return fallback
		}
		return text
	case "index_lookup":
		source := rv.resolve(def["source"], depth+1)
		indexValue := rv.resolve(def["index"], depth+1)
		if result, ok := indexLookupValue(source, indexValue); ok {
			return result
		}
		return fallback
	case "stringadd":
		builder := strings.Builder{}
		for _, rawInput := range listValue(def["inputs"]) {
			input := object(rawInput)
			segment := ""
			switch entry := rawInput.(type) {
			case string:
				segment = entry
			default:
				segment = stringValue(firstNonNil(input["text"], def["text"]))
			}
			if showIf, exists := input["show_if"]; exists {
				if !rv.evalCondition(showIf, depth+1) {
					continue
				}
			}
			resolved := segment
			if strings.Contains(segment, "${") {
				// Template interpolation keeps surrounding whitespace so
				// segments like "  ${title} " space glue text correctly.
				resolved = rv.interpolateTemplate(segment, depth+1)
			} else if value := rv.resolveString(segment, depth+1); value != nil {
				resolved = printable(value)
			}
			if strings.TrimSpace(resolved) != "" {
				builder.WriteString(resolved)
			}
		}
		text := builder.String()
		if text == "" {
			return fallback
		}
		return text
	}
	return fallback
}

// applyValueTransform evaluates mapping transforms like
// "round(value * 10) / 10" with value bound to the computed number. The
// transform is parsed by the same bounded expression engine and never executes
// user code.
func (rv *computedResolver) applyValueTransform(transform string, value float64, depth int) (any, error) {
	scoped := rv.cloneScope(map[string]any{"value": value})
	return evaluateScalarExpression(strings.TrimSpace(transform), &scoped, depth)
}

// indexLookupValue resolves index_lookup: numeric indexes select array
// positions, object sources accept string keys, and non-numeric positional
// texts like "0.used_bytes" use the leading array position.
func indexLookupValue(source, indexValue any) (any, bool) {
	fall := func() (any, bool) { return nil, false }
	switch container := normalizeValue(source).(type) {
	case []any:
		if f, ok := numericOf(indexValue); ok {
			index := int(f)
			if float64(index) == f && index >= 0 && index < len(container) {
				return container[index], true
			}
			return fall()
		}
		if text := strings.TrimSpace(printable(indexValue)); text != "" {
			if match := prefixIndexPattern.FindStringSubmatch(text); match != nil {
				index, _ := strconv.Atoi(match[1])
				if index >= 0 && index < len(container) {
					return container[index], true
				}
			}
		}
		return fall()
	case map[string]any:
		key := strings.TrimSpace(printable(indexValue))
		if value, ok := container[key]; ok {
			return value, true
		}
		return fall()
	default:
		return fall()
	}
}

func flattenListValues(values []any) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		if nested, ok := value.([]any); ok {
			out = append(out, flattenListValues(nested)...)
			continue
		}
		out = append(out, value)
	}
	return out
}

// resolveCount counts a list, string or object. A value node shaped like the
// mapping layer ({iterate, filter}) iterates its rows with the declared filter
// first; plain values keep the previous list-count semantics.
func (rv *computedResolver) resolveCount(def map[string]any, depth int) any {
	if node, ok := normalizeValue(def["value"]).(map[string]any); ok {
		if strings.TrimSpace(stringValue(node["operation"])) == "" {
			if iterate := strings.TrimSpace(stringValue(node["iterate"])); iterate != "" {
				rows, _ := rv.iterateeEntries(iterate, depth+1)
				if len(rows) > maxIterateRows {
					rows = rows[:maxIterateRows]
				}
				counted := 0
				for index, row := range rows {
					rowCtx := rv.childResolver(row.value, index, "", row.value)
					if !rv.rowPassesFilter(node["filter"], rowCtx, depth+1) {
						continue
					}
					counted++
				}
				return counted
			}
		}
	}
	counted := rv.resolve(def["value"], depth+1)
	values := listValue(counted)
	if values == nil {
		values = listValue(def["value"])
	}
	return len(values)
}

// humanBytes ports the reference format resolver: finite byte values shrink to
// the largest unit they reach and non-finite values fail closed to "".
func humanBytes(value any) string {
	if value == nil {
		return ""
	}
	bytes, ok := numericOf(value)
	if !ok || math.IsNaN(bytes) || math.IsInf(bytes, 0) {
		return ""
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	next := math.Abs(bytes)
	unit := 0
	for next >= 1024 && unit < len(units)-1 {
		next /= 1024
		unit++
	}
	sign := ""
	if bytes < 0 {
		sign = "-"
	}
	rounded := math.Round(next)
	if next < 10 {
		rounded = math.Round(next*10) / 10
	}
	return sign + strconv.FormatFloat(rounded, 'f', -1, 64) + " " + units[unit]
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
	tokenBracket
	tokenEOF
)

// expressionToken carries bracket contents for identifier paths:
// server[metric.property][1] lexes as one identifier token holding the
// bracket groups, so dotted/dynamic paths stay a single operand.
type expressionToken struct {
	kind   tokenKind
	text   string
	num    float64
	groups []string
}

var operatorBreakChars = " ()><=!&|-,*?:[]"

func evaluateScalarExpression(expression string, rv *computedResolver, depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	tokens, err := lexExpression(expression)
	if err != nil {
		return nil, err
	}
	parser := &expressionParser{tokens: tokens, resolver: rv}
	result, err := parser.parseTernary(depth + 1)
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
		case c == '-' && i+1 < len(input) && isDigitByte(input[i+1]) && !lastTokenEndsValue(tokens):
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
			raw, groups, end, err := lexIdentifier(input, i)
			if err != nil {
				return nil, err
			}
			switch strings.ToLower(raw) {
			case "and", "or", "not", "contains":
				if err := push(expressionToken{kind: tokenOperator, text: strings.ToLower(raw)}); err != nil {
					return nil, err
				}
			default:
				if err := push(expressionToken{kind: tokenIdentifier, text: raw, groups: groups}); err != nil {
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
			case '>', '<', '+', '-', '*', '/', '!', '?', ':':
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

// lastTokenEndsValue distinguishes unary negative numbers from subtraction.
// Identifiers continue to preserve dashed endpoint names inside paths, while
// expressions such as 5-3 and value-1 tokenize the hyphen as subtraction.
func lastTokenEndsValue(tokens []expressionToken) bool {
	if len(tokens) == 0 {
		return false
	}
	last := tokens[len(tokens)-1]
	switch last.kind {
	case tokenNumber, tokenString, tokenIdentifier:
		return true
	case tokenParen:
		return last.text == ")"
	default:
		return false
	}
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

// lexIdentifier scans one identifier operand, including dotted components and
// dynamic bracket groups (server[metric.property][0] stays a single token).
// A hyphen joins the token only after a '.' or bracket boundary, matching the
// reference tokenizer: endpoint ids like fetch-load-cpu stay whole inside
// paths while unspaced arithmetic (value-size, count-1) lexes as subtraction.
func lexIdentifier(input string, start int) (string, []string, int, error) {
	i := start + 1
	groups := []string{}
	hyphenAllowed := false
	// baseEnd is the extent of the identifier text before the first bracket
	// group; trailing text after the last group (e.g. "...[code].iconNight")
	// is appended as one synthetic path group.
	baseEnd := -1
	lastGroupEnd := -1
scan:
	for i < len(input) {
		char := input[i]
		switch {
		case char == '[':
			if baseEnd < 0 {
				baseEnd = i
			}
			depth := 0
			j := i
			for j < len(input) {
				if input[j] == '[' {
					depth++
				}
				if input[j] == ']' {
					depth--
					if depth == 0 {
						break
					}
				}
				j++
			}
			if j >= len(input) {
				return "", nil, 0, errors.New("unterminated bracket in expression")
			}
			groups = append(groups, input[i+1:j])
			hyphenAllowed = true
			lastGroupEnd = j + 1
			i = j + 1
		case char == ']':
			return "", nil, 0, fmt.Errorf("unexpected ] in expression")
		case char == '.':
			hyphenAllowed = true
			i++
		case char == '-' && hyphenAllowed && i+1 < len(input) && (isLetterByte(input[i+1]) || isDigitByte(input[i+1])):
			i++
		case isWhitespaceByte(char) || strings.IndexByte(operatorBreakChars, char) >= 0:
			break scan
		default:
			i++
		}
	}
	base := input[start:i]
	if lastGroupEnd >= 0 {
		base = input[start:baseEnd]
		if trailing := input[lastGroupEnd:i]; strings.TrimSpace(trailing) != "" {
			groups = append(groups, trailing)
		}
	}
	return base, groups, i, nil
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

// parseTernary implements the math.js conditional a ? b : c on top of the
// or-expression grammar. Branches are evaluated eagerly (the grammar is
// side-effect free) and the selected branch value is returned.
func (p *expressionParser) parseTernary(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	condition, err := p.parseOr(depth)
	if err != nil {
		return nil, err
	}
	token := p.peek()
	if token.kind != tokenOperator || token.text != "?" {
		return condition, nil
	}
	p.next()
	whenTrue, err := p.parseTernary(depth + 1)
	if err != nil {
		return nil, err
	}
	if separator := p.next(); separator.kind != tokenOperator || separator.text != ":" {
		return nil, errors.New("ternary expression requires ':' separator")
	}
	whenFalse, err := p.parseTernary(depth + 1)
	if err != nil {
		return nil, err
	}
	if truthy(condition) {
		return whenTrue, nil
	}
	return whenFalse, nil
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
			left = additiveValues(left, right)
		} else {
			left = toNumber(left) - toNumber(right)
		}
	}
}

// additiveValues mirrors math.js string concatenation for '+' when either
// side is textual ('of ' + humanBytes(total) + ' used'), while numeric
// operands (and nil) keep additive arithmetic.
func additiveValues(left, right any) any {
	if isTextualOperand(left) || isTextualOperand(right) {
		return printable(left) + printable(right)
	}
	return toNumber(left) + toNumber(right)
}

func isTextualOperand(value any) bool {
	_, ok := value.(string)
	return ok
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
			return p.parseFunctionCall(token.text, depth+1)
		}
		value := p.resolver.resolveOperand(token.text, depth)
		for _, group := range token.groups {
			value = p.resolver.resolveBracketMember(value, group, depth)
		}
		return value, nil
	case tokenParen:
		if token.text != "(" {
			return nil, errors.New("unexpected ) in expression")
		}
		value, err := p.parseTernary(depth + 1)
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

// parseFunctionCall evaluates the bounded helper function whitelist; unknown
// functions fail closed so no arbitrary code or math.js can be invoked.
func (p *expressionParser) parseFunctionCall(name string, depth int) (any, error) {
	args, err := p.parseArgumentList(depth)
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(name)
	switch lower {
	case "if":
		if len(args) != 3 {
			return nil, errors.New("if() requires three comma-separated arguments")
		}
		if truthy(args[0]) {
			return args[1], nil
		}
		return args[2], nil
	case "now":
		if len(args) != 0 {
			return nil, errors.New("now() takes no arguments")
		}
		return float64(time.Now().UnixMilli()), nil
	case "round":
		if len(args) < 1 || len(args) > 2 {
			return nil, errors.New("round() takes one or two arguments")
		}
		return roundNumber(toNumber(args[0]), argsToDigits(args[1:]...)), nil
	case "clamp":
		if len(args) != 3 {
			return nil, errors.New("clamp() takes three arguments")
		}
		low, high := toNumber(args[1]), toNumber(args[2])
		value := toNumber(args[0])
		if math.IsNaN(value) {
			return nil, errors.New("clamp() requires a numeric value")
		}
		if high < low {
			low, high = high, low
		}
		return clampNumber(value, low, high), nil
	case "length":
		if len(args) != 1 {
			return nil, errors.New("length() takes one argument")
		}
		return float64(lengthOf(args[0])), nil
	case "isnan":
		if len(args) != 1 {
			return nil, errors.New("isNaN() takes one argument")
		}
		return math.IsNaN(toNumber(args[0])), nil
	case "human_bytes", "humanbytes":
		if len(args) != 1 {
			return nil, errors.New("humanBytes() takes one argument")
		}
		return humanBytes(args[0]), nil
	default:
		return nil, fmt.Errorf("function %q is not supported", name)
	}
}

func argsToDigits(values ...any) float64 {
	if len(values) == 0 {
		return 0
	}
	digits := toNumber(values[0])
	if math.IsNaN(digits) {
		return 0
	}
	if digits > 10 {
		digits = 10
	}
	if digits < 0 {
		digits = 0
	}
	return digits
}

func roundNumber(value, digits float64) float64 {
	if math.IsNaN(value) {
		return value
	}
	if digits == 0 {
		return math.Round(value)
	}
	factor := math.Pow(10, digits)
	return math.Round(value*factor) / factor
}

func clampNumber(value, low, high float64) float64 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

// lengthOf mirrors the reference length helper: lists and strings report
// their element/character count, objects their key count, other values 0.
func lengthOf(value any) int {
	switch v := normalizeValue(value).(type) {
	case []any:
		return len(v)
	case string:
		return len(v)
	case map[string]any:
		return len(v)
	default:
		return 0
	}
}

// parseIfCall consumes if(cond, a, b) branches eagerly (the grammar is
// side-effect free) and returns the branch value the condition selects.
func (p *expressionParser) parseIfCall(depth int) (any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	p.next() // consume "("
	condition, err := p.parseTernary(depth)
	if err != nil {
		return nil, err
	}
	if token := p.next(); token.kind != tokenComma {
		return nil, errors.New("if() requires three comma-separated arguments")
	}
	whenTrue, err := p.parseTernary(depth)
	if err != nil {
		return nil, err
	}
	if token := p.next(); token.kind != tokenComma {
		return nil, errors.New("if() requires three comma-separated arguments")
	}
	whenFalse, err := p.parseTernary(depth)
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

// parseArgumentList handles helper calls like round(value, 2) and
// clamp(x, 0, 100): a bounded comma-separated argument list.
func (p *expressionParser) parseArgumentList(depth int) ([]any, error) {
	if depth > maxExpressionDepth {
		return nil, errors.New("expression nesting too deep")
	}
	p.next() // consume "("
	args := []any{}
	for {
		value, err := p.parseTernary(depth + 1)
		if err != nil {
			return nil, err
		}
		args = append(args, value)
		token := p.next()
		switch {
		case token.kind == tokenComma:
			continue
		case token.kind == tokenParen && token.text == ")":
			return args, nil
		default:
			return nil, errors.New("unbalanced parentheses in expression")
		}
	}
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
