// Package core implements RelayLoom's existing signed-content format using
// maintained Go cryptographic implementations. It is independent of mobile UI.
package core

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

const MaxDepth = 24
const maxCanonicalBytes = 24 * 1024 * 1024

func Hash(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

// Canonical follows the JavaScript canonical() contract, including UTF-16 key
// ordering, JSON.stringify number formatting and unescaped HTML/U+2028/U+2029.
// DecodeJSON preserves lone escaped UTF-16 surrogates as internal WTF-8 strings;
// they are emitted as \uXXXX, so these bytes never appear as invalid wire UTF-8.
func Canonical(value any) ([]byte, error) {
	var out bytes.Buffer
	if err := appendCanonical(&out, reflect.ValueOf(value), 0); err != nil {
		return nil, err
	}
	if out.Len() > maxCanonicalBytes {
		return nil, errors.New("JSON demasiado grande")
	}
	return out.Bytes(), nil
}

func appendCanonical(out *bytes.Buffer, v reflect.Value, depth int) error {
	if depth > MaxDepth {
		return errors.New("estrutura demasiado profunda")
	}
	if out.Len() > maxCanonicalBytes {
		return errors.New("JSON demasiado grande")
	}
	for v.IsValid() && (v.Kind() == reflect.Interface || v.Kind() == reflect.Pointer) {
		if v.IsNil() {
			out.WriteString("null")
			return nil
		}
		v = v.Elem()
	}
	if !v.IsValid() {
		out.WriteString("null")
		return nil
	}
	if v.Type() == reflect.TypeFor[json.Number]() {
		f, err := strconv.ParseFloat(v.String(), 64)
		if err != nil {
			return errors.New("número inválido")
		}
		return appendNumber(out, f)
	}
	switch v.Kind() {
	case reflect.Bool:
		out.WriteString(strconv.FormatBool(v.Bool()))
	case reflect.String:
		return appendString(out, v.String())
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return appendNumber(out, float64(v.Int()))
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return appendNumber(out, float64(v.Uint()))
	case reflect.Float32, reflect.Float64:
		return appendNumber(out, v.Float())
	case reflect.Slice, reflect.Array:
		if v.Kind() == reflect.Slice && v.IsNil() {
			out.WriteString("null")
			return nil
		}
		out.WriteByte('[')
		for i := 0; i < v.Len(); i++ {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := appendCanonical(out, v.Index(i), depth+1); err != nil {
				return err
			}
		}
		out.WriteByte(']')
	case reflect.Map:
		if v.Type().Key().Kind() != reflect.String {
			return errors.New("chave JSON inválida")
		}
		if v.IsNil() {
			out.WriteString("null")
			return nil
		}
		keys := v.MapKeys()
		sort.Slice(keys, func(i, j int) bool { return lessUTF16(keys[i].String(), keys[j].String()) })
		out.WriteByte('{')
		for i, key := range keys {
			if i > 0 {
				out.WriteByte(',')
			}
			if err := appendString(out, key.String()); err != nil {
				return err
			}
			out.WriteByte(':')
			if err := appendCanonical(out, v.MapIndex(key), depth+1); err != nil {
				return err
			}
		}
		out.WriteByte('}')
	case reflect.Struct:
		fields := make(map[string]any)
		if err := structFields(v, fields); err != nil {
			return err
		}
		return appendCanonical(out, reflect.ValueOf(fields), depth)
	default:
		return fmt.Errorf("valor JSON não suportado: %s", v.Kind())
	}
	if out.Len() > maxCanonicalBytes {
		return errors.New("JSON demasiado grande")
	}
	return nil
}

func structFields(v reflect.Value, fields map[string]any) error {
	t := v.Type()
	for i := 0; i < v.NumField(); i++ {
		f := t.Field(i)
		if f.PkgPath != "" {
			continue
		}
		tag := strings.Split(f.Tag.Get("json"), ",")
		if tag[0] == "-" {
			continue
		}
		fv := v.Field(i)
		if f.Anonymous && tag[0] == "" && fv.Kind() == reflect.Struct {
			if err := structFields(fv, fields); err != nil {
				return err
			}
			continue
		}
		if len(tag) > 1 && tag[1] == "omitempty" && fv.IsZero() {
			continue
		}
		name := tag[0]
		if name == "" {
			name = f.Name
		}
		fields[name] = fv.Interface()
	}
	return nil
}

func appendNumber(out *bytes.Buffer, f float64) error {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return errors.New("número não finito")
	}
	if f == 0 {
		out.WriteByte('0')
		return nil
	}
	abs := math.Abs(f)
	format := byte('f')
	if abs < 1e-6 || abs >= 1e21 {
		format = 'e'
	}
	s := strconv.FormatFloat(f, format, -1, 64)
	if i := strings.IndexByte(s, 'e'); i >= 0 {
		mantissa, exp := s[:i], s[i+1:]
		sign := ""
		if exp[0] == '+' || exp[0] == '-' {
			sign = exp[:1]
			exp = exp[1:]
		}
		exp = strings.TrimLeft(exp, "0")
		if exp == "" {
			exp = "0"
		}
		s = mantissa + "e" + sign + exp
	}
	out.WriteString(s)
	return nil
}

func stringRune(s string, at int) (rune, int, error) {
	r, n := utf8.DecodeRuneInString(s[at:])
	if r != utf8.RuneError || n != 1 {
		return r, n, nil
	}
	if at+2 < len(s) && s[at] == 0xed && s[at+1] >= 0xa0 && s[at+1] <= 0xbf && s[at+2]&0xc0 == 0x80 {
		return rune(s[at]&15)<<12 | rune(s[at+1]&63)<<6 | rune(s[at+2]&63), 3, nil
	}
	return 0, 0, errors.New("texto UTF-8 inválido")
}

func appendString(out *bytes.Buffer, s string) error {
	out.WriteByte('"')
	const digits = "0123456789abcdef"
	for at := 0; at < len(s); {
		// Base64 attachments and most JSON text contain long unescaped ASCII
		// runs. Preserve the existing Unicode/WTF-8 path for every other byte.
		begin := at
		for at < len(s) {
			c := s[at]
			if c < 32 || c >= utf8.RuneSelf || c == '"' || c == '\\' {
				break
			}
			at++
		}
		if at > begin {
			if at-begin > maxCanonicalBytes-out.Len() {
				return errors.New("JSON demasiado grande")
			}
			out.WriteString(s[begin:at])
			if at == len(s) {
				break
			}
		}
		r, n, err := stringRune(s, at)
		if err != nil {
			return err
		}
		at += n
		switch r {
		case '"', '\\':
			out.WriteByte('\\')
			out.WriteByte(byte(r))
		case '\b':
			out.WriteString(`\b`)
		case '\f':
			out.WriteString(`\f`)
		case '\n':
			out.WriteString(`\n`)
		case '\r':
			out.WriteString(`\r`)
		case '\t':
			out.WriteString(`\t`)
		default:
			if r < 32 || (r >= 0xd800 && r <= 0xdfff) {
				out.WriteString(`\u`)
				out.WriteByte(digits[(r>>12)&15])
				out.WriteByte(digits[(r>>8)&15])
				out.WriteByte(digits[(r>>4)&15])
				out.WriteByte(digits[r&15])
			} else {
				out.WriteRune(r)
			}
		}
		if out.Len() > maxCanonicalBytes {
			return errors.New("JSON demasiado grande")
		}
	}
	out.WriteByte('"')
	return nil
}

func units(s string) []uint16 {
	u := make([]uint16, 0, len(s))
	for at := 0; at < len(s); {
		r, n, err := stringRune(s, at)
		if err != nil {
			return nil
		}
		at += n
		if r > 0xffff {
			a, b := utf16.EncodeRune(r)
			u = append(u, uint16(a), uint16(b))
		} else {
			u = append(u, uint16(r))
		}
	}
	return u
}
func lessUTF16(a, b string) bool {
	aa, bb := units(a), units(b)
	for i := 0; i < len(aa) && i < len(bb); i++ {
		if aa[i] != bb[i] {
			return aa[i] < bb[i]
		}
	}
	return len(aa) < len(bb)
}
func stringLength(s string) int { return len(units(s)) }

// DecodeJSON bounds wire bytes, nesting and finite numbers without silently
// replacing escaped lone surrogates that are part of a signed JavaScript value.
func DecodeJSON(data []byte, maxBytes int) (any, error) {
	if maxBytes < 1 || len(data) > maxBytes {
		return nil, errors.New("limite JSON")
	}
	p := jsonParser{data: data}
	v, err := p.value(0)
	if err != nil {
		return nil, err
	}
	p.space()
	if p.at != len(data) {
		return nil, errors.New("JSON adicional")
	}
	return v, nil
}

type jsonParser struct {
	data  []byte
	at    int
	nodes int
}

func (p *jsonParser) space() {
	for p.at < len(p.data) && strings.ContainsRune(" \n\r\t", rune(p.data[p.at])) {
		p.at++
	}
}
func (p *jsonParser) value(depth int) (any, error) {
	p.nodes++
	if p.nodes > 100_000 {
		return nil, errors.New("limite de elementos JSON")
	}
	if depth > MaxDepth {
		return nil, errors.New("estrutura demasiado profunda")
	}
	p.space()
	if p.at >= len(p.data) {
		return nil, errors.New("JSON incompleto")
	}
	switch p.data[p.at] {
	case '"':
		return p.text()
	case '{':
		p.at++
		o := make(map[string]any)
		p.space()
		if p.take('}') {
			return o, nil
		}
		for {
			p.space()
			if p.at >= len(p.data) || p.data[p.at] != '"' {
				return nil, errors.New("chave JSON inválida")
			}
			k, err := p.text()
			if err != nil {
				return nil, err
			}
			p.space()
			if !p.take(':') {
				return nil, errors.New("JSON inválido")
			}
			v, err := p.value(depth + 1)
			if err != nil {
				return nil, err
			}
			o[k] = v
			p.space()
			if p.take('}') {
				return o, nil
			}
			if !p.take(',') {
				return nil, errors.New("JSON inválido")
			}
		}
	case '[':
		p.at++
		a := make([]any, 0)
		p.space()
		if p.take(']') {
			return a, nil
		}
		for {
			v, err := p.value(depth + 1)
			if err != nil {
				return nil, err
			}
			a = append(a, v)
			p.space()
			if p.take(']') {
				return a, nil
			}
			if !p.take(',') {
				return nil, errors.New("JSON inválido")
			}
		}
	case 't':
		if p.literal("true") {
			return true, nil
		}
	case 'f':
		if p.literal("false") {
			return false, nil
		}
	case 'n':
		if p.literal("null") {
			return nil, nil
		}
	default:
		return p.number()
	}
	return nil, errors.New("JSON inválido")
}
func (p *jsonParser) take(c byte) bool {
	if p.at < len(p.data) && p.data[p.at] == c {
		p.at++
		return true
	}
	return false
}
func (p *jsonParser) literal(s string) bool {
	if bytes.HasPrefix(p.data[p.at:], []byte(s)) {
		p.at += len(s)
		return true
	}
	return false
}
func (p *jsonParser) number() (any, error) {
	start := p.at
	p.take('-')
	if p.at >= len(p.data) {
		return nil, errors.New("número inválido")
	}
	if !p.take('0') {
		if p.data[p.at] < '1' || p.data[p.at] > '9' {
			return nil, errors.New("número inválido")
		}
		for p.at < len(p.data) && p.data[p.at] >= '0' && p.data[p.at] <= '9' {
			p.at++
		}
	}
	if p.take('.') {
		first := p.at
		for p.at < len(p.data) && p.data[p.at] >= '0' && p.data[p.at] <= '9' {
			p.at++
		}
		if first == p.at {
			return nil, errors.New("número inválido")
		}
	}
	if p.take('e') || p.take('E') {
		if !p.take('+') {
			p.take('-')
		}
		first := p.at
		for p.at < len(p.data) && p.data[p.at] >= '0' && p.data[p.at] <= '9' {
			p.at++
		}
		if first == p.at {
			return nil, errors.New("número inválido")
		}
	}
	s := string(p.data[start:p.at])
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil, errors.New("número inválido")
	}
	return json.Number(s), nil
}
func (p *jsonParser) hexUnit() (uint16, error) {
	if p.at+4 > len(p.data) {
		return 0, errors.New("escape incompleto")
	}
	n, err := strconv.ParseUint(string(p.data[p.at:p.at+4]), 16, 16)
	p.at += 4
	return uint16(n), err
}
func (p *jsonParser) text() (string, error) {
	p.at++
	var b bytes.Buffer
	for p.at < len(p.data) {
		c := p.data[p.at]
		p.at++
		if c == '"' {
			return b.String(), nil
		}
		if c < 32 {
			return "", errors.New("texto JSON inválido")
		}
		if c != '\\' {
			if c < utf8.RuneSelf {
				b.WriteByte(c)
				continue
			}
			p.at--
			r, n := utf8.DecodeRune(p.data[p.at:])
			if r == utf8.RuneError && n == 1 {
				return "", errors.New("texto UTF-8 inválido")
			}
			b.Write(p.data[p.at : p.at+n])
			p.at += n
			continue
		}
		if p.at >= len(p.data) {
			return "", errors.New("escape incompleto")
		}
		c = p.data[p.at]
		p.at++
		switch c {
		case '"', '\\', '/':
			b.WriteByte(c)
		case 'b':
			b.WriteByte('\b')
		case 'f':
			b.WriteByte('\f')
		case 'n':
			b.WriteByte('\n')
		case 'r':
			b.WriteByte('\r')
		case 't':
			b.WriteByte('\t')
		case 'u':
			u, err := p.hexUnit()
			if err != nil {
				return "", err
			}
			if u >= 0xd800 && u <= 0xdbff && p.at+6 <= len(p.data) && p.data[p.at] == '\\' && p.data[p.at+1] == 'u' {
				saved := p.at
				p.at += 2
				low, e := p.hexUnit()
				if e == nil && low >= 0xdc00 && low <= 0xdfff {
					b.WriteRune(utf16.DecodeRune(rune(u), rune(low)))
					continue
				}
				p.at = saved
			}
			if u >= 0xd800 && u <= 0xdfff {
				b.WriteByte(byte(0xe0 | (u >> 12)))
				b.WriteByte(byte(0x80 | ((u >> 6) & 63)))
				b.WriteByte(byte(0x80 | (u & 63)))
			} else {
				b.WriteRune(rune(u))
			}
		default:
			return "", errors.New("escape JSON inválido")
		}
	}
	return "", errors.New("texto incompleto")
}
