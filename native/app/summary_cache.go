package app

import (
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/transport"
)

const summaryCacheBytes = 16 * 1024 * 1024
const summaryCacheEntries = 1024

type summaryEntry struct {
	object DisplayObject
	bytes  int
	used   uint64
}

func (n *Node) clearSummariesLocked() {
	n.summaries = make(map[string]summaryEntry)
	n.summaryBytes = 0
	n.summaryIdentity = ""
	n.summarySequence = 0
}
func (n *Node) removeSummaryLocked(id string) {
	if previous, exists := n.summaries[id]; exists {
		n.summaryBytes -= previous.bytes
		delete(n.summaries, id)
	}
}

// Cache only immutable verified display metadata. Never keep a full attachment.
func (n *Node) cacheSummaryLocked(object DisplayObject) error {
	encoded, err := core.Canonical(object)
	if err != nil {
		return err
	}
	if len(encoded) > summaryCacheBytes {
		return nil
	}
	n.removeSummaryLocked(object.ID)
	for len(n.summaries) >= summaryCacheEntries || n.summaryBytes+len(encoded) > summaryCacheBytes {
		oldest := ""
		for id, entry := range n.summaries {
			if oldest == "" || entry.used < n.summaries[oldest].used {
				oldest = id
			}
		}
		n.removeSummaryLocked(oldest)
	}
	n.summarySequence++
	n.summaries[object.ID] = summaryEntry{cloneSummary(object), len(encoded), n.summarySequence}
	n.summaryBytes += len(encoded)
	return nil
}

// State() is also a public Go API: callers must not obtain mutable aliases into
// the cache. These are the closed set of types produced by summaryContent.
func copySummaryValue(value any) any {
	switch v := value.(type) {
	case Content:
		out := Content{}
		for key, value := range v {
			out[key] = copySummaryValue(value)
		}
		return out
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, value := range v {
			out[key] = copySummaryValue(value)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, value := range v {
			out[i] = copySummaryValue(value)
		}
		return out
	case []core.PublicIdentity:
		return append([]core.PublicIdentity{}, v...)
	case []string:
		return append([]string{}, v...)
	default:
		return value
	}
}
func cloneSummary(object DisplayObject) DisplayObject {
	object.Content = copySummaryValue(object.Content).(Content)
	object.Readers = append([]string{}, object.Readers...)
	if route, ok := object.Route.(transport.Route); ok {
		route.Hops = append([]string{}, route.Hops...)
		object.Route = route
	}
	if object.EditedText != nil {
		value := *object.EditedText
		object.EditedText = &value
	}
	return object
}
