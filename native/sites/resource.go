package sites

import (
	"bytes"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const ResourceFileBytes = 2 * 1024 * 1024
const resourceDomain = "relayloom/site-resource/1"
const resourceReferenceDomain = "relayloom/site-resource-reference/1"
const resourceTableMIME = "application/vnd.relayloom.table+json"

var resourceBase64 = regexp.MustCompile(`^[A-Za-z0-9+/]*={0,2}$`)
var resourceFileTypes = []string{
	"application/octet-stream", "application/pdf", "application/zip", "application/json",
	"text/plain", "text/csv", "image/png", "image/jpeg", "image/webp", "image/gif",
	"audio/ogg", "audio/mpeg", "audio/mp4", "audio/wav", "audio/webm", "video/mp4", "video/webm",
}

func resourceError() error { return errors.New("recurso de site inválido") }
func resourceName(value any) bool {
	name, ok := value.(string)
	if !ok || len(name) > 600 || docLength(name) > 150 || docTrim(name) == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\") {
		return false
	}
	for _, r := range name {
		if r < 32 || r == 127 {
			return false
		}
	}
	return true
}
func resourceFile(value any) ([]byte, error) {
	encoded, ok := value.(string)
	if !ok || len(encoded) > ((ResourceFileBytes+2)/3)*4 || len(encoded)%4 != 0 || !resourceBase64.MatchString(encoded) {
		return nil, resourceError()
	}
	decoded, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(decoded) > ResourceFileBytes || base64.StdEncoding.EncodeToString(decoded) != encoded {
		return nil, resourceError()
	}
	return decoded, nil
}
func resourceClone(value map[string]any) (map[string]any, error) {
	encoded, err := core.Canonical(value)
	if err != nil || len(encoded) > PayloadBytes {
		return nil, resourceError()
	}
	clone, err := core.DecodeJSON(encoded, PayloadBytes)
	if err != nil {
		return nil, err
	}
	return clone.(map[string]any), nil
}

// ParseResource validates a declarative payload. It does not authenticate its
// envelope, authorise access, fetch content or interpret file bytes as code.
func ParseResource(value any) (map[string]any, error) {
	resource, err := object(value, "type", "domain", "name", "kind", "table")
	table := err == nil
	if !table {
		resource, err = object(value, "type", "domain", "name", "kind", "mime", "data")
	}
	if err != nil || resource["type"] != "site-resource" || resource["domain"] != resourceDomain || !resourceName(resource["name"]) {
		return nil, resourceError()
	}
	if table {
		if resource["kind"] != "table" || ValidateDataTable(resource["table"]) != nil {
			return nil, resourceError()
		}
	} else {
		if resource["kind"] != "file" || !docContains(resourceFileTypes, docTextValue(resource["mime"])) {
			return nil, resourceError()
		}
		if _, err := resourceFile(resource["data"]); err != nil {
			return nil, err
		}
	}
	return resourceClone(resource)
}
func ParseResourceReference(value any) (map[string]any, error) {
	ref, err := object(value, "domain", "bundleId", "authorId", "kind", "name", "mime", "bytes", "payloadHash")
	if err != nil || ref["domain"] != resourceReferenceDomain || !core.ValidAddress(docTextValue(ref["bundleId"])) || !core.ValidAddress(docTextValue(ref["authorId"])) || !core.ValidAddress(docTextValue(ref["payloadHash"])) || !resourceName(ref["name"]) {
		return nil, resourceError()
	}
	minimum, maximum := int64(0), int64(ResourceFileBytes)
	if ref["kind"] == "table" {
		minimum, maximum = 1, SiteTableBytes
		if ref["mime"] != resourceTableMIME {
			return nil, resourceError()
		}
	} else if ref["kind"] != "file" || !docContains(resourceFileTypes, docTextValue(ref["mime"])) {
		return nil, resourceError()
	}
	size, err := docNumber(ref["bytes"])
	if err != nil || size < minimum || size > maximum {
		return nil, resourceError()
	}
	return resourceClone(ref)
}

// DescribeResource requires metadata from an already verified and decrypted
// envelope. Checking this mapping alone never substitutes for core verification.
func DescribeResource(value any, envelope any) (map[string]any, error) {
	metadata, err := object(envelope, "id", "authorId", "kind")
	if err != nil || !core.ValidAddress(docTextValue(metadata["id"])) || !core.ValidAddress(docTextValue(metadata["authorId"])) || metadata["kind"] != "site-resource" {
		return nil, resourceError()
	}
	resource, err := ParseResource(value)
	if err != nil {
		return nil, err
	}
	encoded, err := core.Canonical(resource)
	if err != nil {
		return nil, err
	}
	var size int
	var mime string
	if resource["kind"] == "table" {
		data, err := core.Canonical(resource["table"])
		if err != nil {
			return nil, err
		}
		size, mime = len(data), resourceTableMIME
	} else {
		data, err := resourceFile(resource["data"])
		if err != nil {
			return nil, err
		}
		size, mime = len(data), docTextValue(resource["mime"])
	}
	return ParseResourceReference(map[string]any{
		"domain": resourceReferenceDomain, "bundleId": metadata["id"], "authorId": metadata["authorId"],
		"kind": resource["kind"], "name": resource["name"], "mime": mime, "bytes": size, "payloadHash": core.Hash(encoded),
	})
}
func MatchResource(reference any, value any, envelope any) (map[string]any, error) {
	expected, err := ParseResourceReference(reference)
	if err != nil {
		return nil, err
	}
	actual, err := DescribeResource(value, envelope)
	if err != nil {
		return nil, err
	}
	a, err := core.Canonical(actual)
	if err != nil {
		return nil, err
	}
	b, err := core.Canonical(expected)
	if err != nil || !bytes.Equal(a, b) {
		return nil, resourceError()
	}
	return ParseResource(value)
}
func resourceScope(value any) (bool, []string, error) {
	if text, ok := value.(string); ok && text == "public" {
		return true, nil, nil
	}
	values, ok := value.([]any)
	if !ok || len(values) < 1 || len(values) > 64 {
		return false, nil, resourceError()
	}
	readers := make([]string, len(values))
	for i, v := range values {
		reader, ok := v.(string)
		if !ok || !core.ValidAddress(reader) || (i > 0 && readers[i-1] >= reader) {
			return false, nil, resourceError()
		}
		readers[i] = reader
	}
	return false, readers, nil
}

// ResourceScopeCoversSite consumes authenticated audience metadata at the
// runtime boundary. A public page cannot make a private resource public.
func ResourceScopeCoversSite(siteValue any, resourceValue any) (bool, error) {
	sitePublic, site, err := resourceScope(siteValue)
	if err != nil {
		return false, err
	}
	resourcePublic, resource, err := resourceScope(resourceValue)
	if err != nil {
		return false, err
	}
	if resourcePublic {
		return true, nil
	}
	if sitePublic {
		return false, nil
	}
	for _, reader := range site {
		if !docContains(resource, reader) {
			return false, nil
		}
	}
	return true, nil
}
