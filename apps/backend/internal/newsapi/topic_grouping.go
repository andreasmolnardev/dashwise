package newsapi

import (
	"strings"
	"unicode"
)

type TopicGroupingSettings struct {
	Enabled           bool
	IgnoreDescription bool
	Blacklist         map[string]bool
}

// groupNewsTopics turns similar articles into the relatedArticles shape used
// by the retained News views. Grouping is enabled per subscription, matching
// the controls exposed in the subscription editor.
func GroupTopics(items []any, settings map[string]TopicGroupingSettings) []any {
	if len(items) < 2 {
		return items
	}
	articles := make([]map[string]any, len(items))
	for index, raw := range items {
		articles[index], _ = raw.(map[string]any)
	}
	removed := make([]bool, len(items))
	for i := range articles {
		if articles[i] == nil || removed[i] {
			continue
		}
		for j := i + 1; j < len(articles); j++ {
			if articles[j] == nil || removed[j] || !canGroup(articles[i], articles[j], settings) {
				continue
			}
			if !similarTopic(articles[i], articles[j], settings) {
				continue
			}
			related, _ := articles[i]["relatedArticles"].([]any)
			related = append(related, articles[j])
			articles[i]["relatedArticles"] = related
			removed[j] = true
		}
	}
	result := make([]any, 0, len(items))
	for i, item := range items {
		if !removed[i] {
			result = append(result, item)
		}
	}
	return result
}

func canGroup(a, b map[string]any, settings map[string]TopicGroupingSettings) bool {
	left, right := sourceIDs(a), sourceIDs(b)
	for id := range left {
		if right[id] && settings[id].Enabled {
			return true
		}
	}
	return false
}

func sourceIDs(item map[string]any) map[string]bool {
	ids := map[string]bool{}
	if id, ok := item["subscription_id"].(string); ok && id != "" {
		ids[id] = true
	}
	if sources, ok := item["sourceSubscriptions"].([]map[string]string); ok {
		for _, source := range sources {
			ids[source["id"]] = true
		}
	}
	if sources, ok := item["sourceSubscriptions"].([]any); ok {
		for _, raw := range sources {
			if source, ok := raw.(map[string]any); ok {
				if id, ok := source["id"].(string); ok {
					ids[id] = true
				}
			}
		}
	}
	return ids
}

func similarTopic(a, b map[string]any, settings map[string]TopicGroupingSettings) bool {
	wordsA := topicWords(a, settings)
	wordsB := topicWords(b, settings)
	if len(wordsA) < 2 || len(wordsB) < 2 {
		return false
	}
	intersection := 0
	for word := range wordsA {
		if wordsB[word] {
			intersection++
		}
	}
	union := len(wordsA) + len(wordsB) - intersection
	return intersection >= 2 && union > 0 && float64(intersection)/float64(union) >= 0.5
}

func topicWords(item map[string]any, settings map[string]TopicGroupingSettings) map[string]bool {
	words := map[string]bool{}
	for id := range sourceIDs(item) {
		config := settings[id]
		for word := range splitTopicWords(textValue(item["title"])) {
			if !config.Blacklist[word] {
				words[word] = true
			}
		}
		if !config.IgnoreDescription {
			for word := range splitTopicWords(textValue(item["description"])) {
				if !config.Blacklist[word] {
					words[word] = true
				}
			}
		}
	}
	return words
}

func textValue(value any) string {
	text, _ := value.(string)
	return text
}

func splitTopicWords(value string) map[string]bool {
	words := map[string]bool{}
	for _, word := range strings.FieldsFunc(strings.ToLower(value), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsNumber(r) }) {
		if len([]rune(word)) >= 3 {
			words[word] = true
		}
	}
	return words
}
