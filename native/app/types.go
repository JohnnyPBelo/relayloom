// Package app is the on-device RelayLoom application engine. Its authenticated
// API and signed-content rules are shared by the mobile binding and native CLI.
package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
)

type Content map[string]any
type DisplayObject struct {
	ID         string              `json:"id"`
	Author     core.PublicIdentity `json:"author"`
	Kind       string              `json:"kind"`
	Created    int64               `json:"created"`
	Expires    int64               `json:"expires"`
	Content    Content             `json:"content"`
	Pinned     bool                `json:"pinned"`
	Readers    []string            `json:"readers"`
	Public     bool                `json:"public"`
	Deleted    bool                `json:"deleted"`
	EditedText *string             `json:"editedText,omitempty"`
	Route      any                 `json:"route,omitempty"`
}
type PeerAddress struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}
type Report struct {
	Target string `json:"target"`
	Reason string `json:"reason"`
	At     int64  `json:"at"`
}
type Config struct {
	Contacts  []core.PublicIdentity `json:"contacts"`
	Blocked   []string              `json:"blocked"`
	Following []string              `json:"following"`
	Saved     []string              `json:"saved"`
	Reports   []Report              `json:"reports"`
	Relay     bool                  `json:"relay"`
	LowPower  bool                  `json:"lowPower"`
	Quota     int64                 `json:"quota"`
	Peers     []PeerAddress         `json:"peers"`
}
type Mutation struct {
	Author  string  `json:"author"`
	Expires int64   `json:"expires"`
	Created int64   `json:"created"`
	EventID string  `json:"eventId"`
	Deleted bool    `json:"deleted,omitempty"`
	Text    *string `json:"text,omitempty"`
}
type PrivateState struct {
	Outbox      map[string]OutboxRecord `json:"outbox"`
	Mutations   map[string]Mutation     `json:"mutations"`
	Collections []Collection            `json:"collections,omitempty"`
	SiteDraft   map[string]any          `json:"siteDraft,omitempty"`
}

func defaultConfig() Config {
	return Config{Contacts: []core.PublicIdentity{}, Blocked: []string{}, Following: []string{}, Saved: []string{}, Reports: []Report{}, Relay: true, Quota: core.DefaultQuota, Peers: []PeerAddress{}}
}
func emptyPrivate() PrivateState {
	return PrivateState{Outbox: map[string]OutboxRecord{}, Mutations: map[string]Mutation{}, Collections: []Collection{}}
}
func object(v any) (map[string]any, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, errors.New("objecto inválido")
	}
	return m, nil
}
func text(v any) string { s, _ := v.(string); return s }
func number(v any) (int64, error) {
	var f float64
	switch n := v.(type) {
	case json.Number:
		var e error
		f, e = n.Float64()
		if e != nil {
			return 0, e
		}
	case float64:
		f = n
	case int:
		return int64(n), nil
	case int64:
		return n, nil
	default:
		return 0, errors.New("inteiro inválido")
	}
	if math.IsNaN(f) || math.IsInf(f, 0) || math.Trunc(f) != f || math.Abs(f) > 9007199254740991 {
		return 0, errors.New("inteiro inválido")
	}
	return int64(f), nil
}
func boolean(v any) (bool, error) {
	b, ok := v.(bool)
	if !ok {
		return false, errors.New("booleano inválido")
	}
	return b, nil
}
func jsLen(s string) int {
	count := 0
	for i := 0; i < len(s); {
		r, n := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && n == 1 && i+2 < len(s) && s[i] == 0xed && s[i+1] >= 0xa0 && s[i+1] <= 0xbf && s[i+2]&0xc0 == 0x80 {
			i += 3
			count++
			continue
		}
		i += n
		if r > 0xffff {
			count += 2
		} else {
			count++
		}
	}
	return count
}
func trimmed(s string) string {
	return strings.TrimFunc(s, func(r rune) bool {
		return r == 9 || r == 10 || r == 11 || r == 12 || r == 13 || r == 32 || r == 0xa0 || r == 0x1680 || (r >= 0x2000 && r <= 0x200a) || r == 0x2028 || r == 0x2029 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff
	})
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}
func stringsList(v any, maximum int, addresses bool) ([]string, error) {
	a, ok := v.([]any)
	if !ok {
		if s, ok := v.([]string); ok {
			a = make([]any, len(s))
			for i, v := range s {
				a[i] = v
			}
		} else {
			return nil, errors.New("lista inválida")
		}
	}
	if len(a) > maximum {
		return nil, errors.New("limite de referências")
	}
	out := make([]string, 0, len(a))
	for _, value := range a {
		s, ok := value.(string)
		if !ok || (addresses && !core.ValidAddress(s)) {
			return nil, errors.New("endereço inválido")
		}
		out = append(out, s)
	}
	return out, nil
}
func sorted(values []string) []string {
	out := append([]string{}, values...)
	sort.Strings(out)
	return out
}
func equalIDs(a, b []string) bool {
	aa, bb := sorted(a), sorted(b)
	if len(aa) != len(bb) {
		return false
	}
	for i := range aa {
		if aa[i] != bb[i] {
			return false
		}
	}
	return true
}
func cloneValue(value any) (any, error) {
	data, err := core.Canonical(value)
	if err != nil {
		return nil, err
	}
	return core.DecodeJSON(data, 24*1024*1024)
}
func publicIdentity(v any) (core.PublicIdentity, error) {
	data, err := core.Canonical(v)
	if err != nil {
		return core.PublicIdentity{}, err
	}
	p, err := core.DecodePublicIdentity(data)
	if err != nil {
		return p, err
	}
	return p, core.ValidateIdentity(p)
}
func members(v any) ([]core.PublicIdentity, error) {
	a, ok := v.([]any)
	if !ok {
		if typed, ok := v.([]core.PublicIdentity); ok {
			a = make([]any, len(typed))
			for i, p := range typed {
				a[i] = p
			}
		} else {
			return nil, errors.New("membros inválidos")
		}
	}
	if len(a) > 64 {
		return nil, errors.New("limite de membros")
	}
	out := make([]core.PublicIdentity, 0, len(a))
	for _, value := range a {
		p, err := publicIdentity(value)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}
func memberIDs(m []core.PublicIdentity) []string {
	ids := make([]string, 0, len(m))
	for _, p := range m {
		ids = append(ids, p.ID)
	}
	return ids
}
func decodeBundle(v any) (core.Bundle, error) {
	data, err := core.Canonical(v)
	if err != nil {
		return core.Bundle{}, err
	}
	b, err := core.DecodeBundle(data)
	if err != nil {
		return b, err
	}
	return b, core.VerifyBundle(b)
}
func related(kind string) bool {
	return contains([]string{"edit", "delete", "reaction", "comment", "receipt", "delivery"}, kind)
}
func tcpAddress(host string, port int) (string, error) {
	if host == "" || len(host) > 253 || port < 1 || port > 65535 {
		return "", errors.New("endereço TCP inválido")
	}
	return net.JoinHostPort(host, strconv.Itoa(port)), nil
}

var base64Pattern = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)

func validateContent(c Content) error {
	kind := text(c["type"])
	if kind == "site-contribution-receipt" {
		_, err := sites.ParseContributionReceiptContent(map[string]any(c))
		return err
	}
	if kind == "site-contribution-rejection" {
		_, err := sites.ParseContributionRejectionContent(map[string]any(c))
		return err
	}
	if kind == "site-contribution" {
		_, err := sites.ParseContributionContent(map[string]any(c))
		return err
	}
	if kind == "site-resource" {
		_, err := sites.ParseResource(map[string]any(c))
		return err
	}
	if !contains([]string{"message", "post", "group", "site", "comment", "reaction", "edit", "delete", "receipt", "delivery", "alert"}, kind) {
		return errors.New("tipo de conteúdo inválido")
	}
	if value, exists := c["priority"]; exists {
		priority, ok := value.(string)
		if !ok || !contains([]string{"sos", "normal", "bulk"}, priority) {
			return errors.New("prioridade inválida")
		}
	}
	if value, exists := c["value"]; exists {
		if _, ok := value.(bool); !ok {
			return errors.New("valor de conteúdo inválido")
		}
	}
	if value, exists := c["theme"]; exists {
		if _, ok := value.(string); !ok {
			return errors.New("tema inválido")
		}
	}
	for _, key := range []string{"text", "title", "conversation", "target", "replyTo", "emoji"} {
		if value, ok := c[key]; ok {
			limit := 256
			if key == "text" {
				limit = 12000
			}
			s, ok := value.(string)
			if !ok || jsLen(s) > limit {
				return errors.New("texto demasiado longo ou inválido")
			}
		}
	}
	if value, ok := c["members"]; ok {
		if _, err := members(value); err != nil {
			return err
		}
	}
	if value, ok := c["attachments"]; ok {
		a, ok := value.([]any)
		if !ok || len(a) > 4 {
			return errors.New("máximo de quatro anexos")
		}
		for _, value := range a {
			m, err := object(value)
			if err != nil {
				return err
			}
			name, nok := m["name"].(string)
			mime, mok := m["mime"].(string)
			data, dok := m["data"].(string)
			if !nok || jsLen(name) > 150 || !mok || jsLen(mime) > 100 || !dok || len(data) > 3500000 || !base64Pattern.MatchString(data) {
				return errors.New("anexo inválido ou demasiado grande")
			}
		}
	}
	if kind == "site" {
		if site, exists := c["site"]; exists {
			if err := validateSite(site, c["attachments"]); err != nil {
				return err
			}
		}
		blocks, ok := c["blocks"].([]any)
		theme := "sand"
		if value, exists := c["theme"]; exists && value != nil {
			var ok bool
			theme, ok = value.(string)
			if !ok {
				return errors.New("tema inválido")
			}
		}
		if !ok || len(blocks) > 24 || !contains([]string{"sand", "forest", "ink"}, theme) {
			return errors.New("página inválida")
		}
		for _, value := range blocks {
			b, err := object(value)
			if err != nil {
				return err
			}
			id, iok := b["id"].(string)
			title, tok := b["title"].(string)
			body, bok := b["body"].(string)
			if !iok || jsLen(id) > 64 || !contains([]string{"hero", "text", "links", "callout"}, text(b["type"])) || !tok || jsLen(title) > 120 || !bok || jsLen(body) > 4000 {
				return errors.New("bloco declarativo inválido")
			}
			if value, ok := b["url"]; ok {
				url, ok := value.(string)
				if !ok || jsLen(url) > 2000 || (url != "" && !strings.HasPrefix(url, "https://")) {
					return errors.New("ligação de bloco inválida")
				}
			}
		}
	}
	_, err := core.Canonical(c)
	return err
}
func parseConfig(value any) (Config, error) {
	c := defaultConfig()
	m, err := object(value)
	if err != nil {
		return c, err
	}
	if value, ok := m["contacts"]; ok {
		a, ok := value.([]any)
		if !ok || len(a) > 256 {
			return c, errors.New("contactos inválidos")
		}
		for _, v := range a {
			p, err := publicIdentity(v)
			if err != nil {
				return c, err
			}
			c.Contacts = append(c.Contacts, p)
		}
	}
	for _, field := range []struct {
		name  string
		dst   *[]string
		limit int
	}{{"blocked", &c.Blocked, 2048}, {"following", &c.Following, 256}, {"saved", &c.Saved, 2048}} {
		if v, ok := m[field.name]; ok {
			list, err := stringsList(v, field.limit, true)
			if err != nil {
				return c, err
			}
			*field.dst = list
		}
	}
	for _, field := range []struct {
		name string
		dst  *bool
	}{{"relay", &c.Relay}, {"lowPower", &c.LowPower}} {
		if v, ok := m[field.name]; ok {
			b, e := boolean(v)
			if e != nil {
				return c, e
			}
			*field.dst = b
		}
	}
	if v, ok := m["quota"]; ok {
		c.Quota, err = number(v)
		if err != nil || c.Quota < 1 || c.Quota > 1024*1024*1024 {
			return c, errors.New("quota inválida")
		}
	}
	if value, ok := m["peers"]; ok {
		a, ok := value.([]any)
		if !ok || len(a) > 16 {
			return c, errors.New("pares inválidos")
		}
		for _, v := range a {
			m, e := object(v)
			if e != nil {
				return c, e
			}
			port, e := number(m["port"])
			if e != nil {
				return c, e
			}
			host := text(m["host"])
			if _, e = tcpAddress(host, int(port)); e != nil {
				return c, e
			}
			c.Peers = append(c.Peers, PeerAddress{host, int(port)})
		}
	}
	if value, ok := m["reports"]; ok {
		a, ok := value.([]any)
		if !ok || len(a) > 200 {
			return c, errors.New("denúncias inválidas")
		}
		for _, v := range a {
			m, e := object(v)
			if e != nil {
				return c, e
			}
			at, e := number(m["at"])
			if e != nil || !core.ValidAddress(text(m["target"])) || jsLen(text(m["reason"])) > 500 {
				return c, errors.New("denúncia inválida")
			}
			c.Reports = append(c.Reports, Report{text(m["target"]), text(m["reason"]), at})
		}
	}
	return c, nil
}
func fieldString(body map[string]any, key string) (string, error) {
	value, ok := body[key].(string)
	if !ok {
		return "", fmt.Errorf("%s inválido", key)
	}
	return value, nil
}
