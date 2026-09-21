package sites

import (
	"encoding/base64"
	"errors"
	"regexp"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

const ContributionBytes = 16 * 1024
const ContributionLifetimeMS int64 = 30 * 86400000
const ContributionClockSkewMS int64 = 300000 // Same policy as authenticated envelopes.

var contributionOperationPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

func contributionError() error { return errors.New("proposta de site inválida") }
func contributionTarget(value any) (map[string]any, error) {
	target, err := object(value, "site", "snapshotId", "revisionId", "pageId", "formId")
	if err != nil {
		return nil, contributionError()
	}
	if _, _, err = ParseAddress(docTextValue(target["site"])); err != nil {
		return nil, err
	}
	for _, k := range []string{"snapshotId", "revisionId"} {
		if !core.ValidAddress(docTextValue(target[k])) {
			return nil, contributionError()
		}
	}
	for _, k := range []string{"pageId", "formId"} {
		if !siteIDPattern.MatchString(docTextValue(target[k])) {
			return nil, contributionError()
		}
	}
	return target, nil
}
func contributionBody(value any) (map[string]any, core.PublicIdentity, error) {
	var none core.PublicIdentity
	b, err := object(value, "domain", "contributor", "target", "schemaHash", "operationId", "created", "expires", "values", "publicationScope")
	if err != nil || b["domain"] != "relayloom/site-contribution/1" {
		return nil, none, contributionError()
	}
	card, err := bounded(b["contributor"], CertificateBytes)
	if err != nil {
		return nil, none, err
	}
	contributor, err := core.DecodePublicIdentity(card)
	if err != nil {
		return nil, none, err
	}
	target, err := contributionTarget(b["target"])
	if err != nil {
		return nil, none, err
	}
	if !core.ValidAddress(docTextValue(b["schemaHash"])) || !contributionOperationPattern.MatchString(docTextValue(b["operationId"])) {
		return nil, none, contributionError()
	}
	created, e1 := docNumber(b["created"])
	expires, e2 := docNumber(b["expires"])
	if e1 != nil || e2 != nil || created < 0 || created > MaxSequence || expires > MaxSequence || expires <= created || expires-created > ContributionLifetimeMS {
		return nil, none, contributionError()
	}
	if _, err = ParseContributionValues(b["values"]); err != nil {
		return nil, none, err
	}
	public, readers, err := resourceScope(b["publicationScope"])
	if err != nil {
		return nil, none, err
	}
	owner, _, _ := ParseAddress(target["site"].(string))
	if !public && (!docContains(readers, owner) || !docContains(readers, contributor.ID)) {
		return nil, none, contributionError()
	}
	if _, err = bounded(b, ContributionBytes); err != nil {
		return nil, none, err
	}
	return b, contributor, nil
}

// VerifyContribution checks historical authenticity, not expiry, acceptance or
// permission to change the owner's page. It returns an owned canonical value.
func VerifyContribution(value any) (map[string]any, error) {
	cert, err := object(value, "body", "id", "signature")
	if err != nil {
		return nil, contributionError()
	}
	body, author, err := contributionBody(cert["body"])
	if err != nil {
		return nil, err
	}
	text, err := bounded(body, ContributionBytes)
	if err != nil {
		return nil, err
	}
	id, signature := docTextValue(cert["id"]), docTextValue(cert["signature"])
	if !core.ValidAddress(id) || id != core.Hash(text) || len(signature) != 88 {
		return nil, contributionError()
	}
	bytes, err := base64.StdEncoding.Strict().DecodeString(signature)
	if err != nil || len(bytes) != 64 || base64.StdEncoding.EncodeToString(bytes) != signature {
		return nil, contributionError()
	}
	if err = core.VerifyCertificateData(author, text, bytes); err != nil {
		return nil, err
	}
	if _, err = bounded(cert, ContributionBytes); err != nil {
		return nil, err
	}
	return resourceClone(cert)
}
func DecodeContribution(data []byte) (map[string]any, error) {
	value, err := core.DecodeJSON(data, ContributionBytes)
	if err != nil {
		return nil, err
	}
	return VerifyContribution(value)
}
func CreateContribution(identity core.Identity, input any) (map[string]any, error) {
	q, err := object(input, "target", "schemaHash", "operationId", "created", "expires", "values", "publicationScope")
	if err != nil {
		return nil, contributionError()
	}
	// Validate before cloning or signing; the card is always the real signer.
	b := map[string]any{"domain": "relayloom/site-contribution/1", "contributor": identity.Public}
	for key, value := range q {
		b[key] = value
	}
	if _, _, err = contributionBody(b); err != nil {
		return nil, err
	}
	text, err := bounded(b, ContributionBytes)
	if err != nil {
		return nil, err
	}
	signature, err := core.SignCertificateData(identity, text)
	if err != nil {
		return nil, err
	}
	return VerifyContribution(map[string]any{"body": b, "id": core.Hash(text), "signature": base64.StdEncoding.EncodeToString(signature)})
}
func ContributionSchemaHash(formValue, tableValue any) (string, error) {
	form, table, err := BindSiteForm(formValue, tableValue)
	if err != nil {
		return "", err
	}
	text, err := bounded(map[string]any{"domain": "relayloom/site-form-schema/1", "form": form, "columns": table["columns"]}, ContributionBytes)
	if err != nil {
		return "", err
	}
	return core.Hash(text), nil
}

// ContributionFormContext must come from an authenticated/decrypted snapshot.
// It is not a wire command or an approval capability supplied by the client.
type ContributionFormContext struct {
	Target          any
	Form            any
	Table           any
	SiteScope       any
	SnapshotExpires int64
}

func VerifyContributionForForm(value any, context ContributionFormContext, now int64) (map[string]any, error) {
	cert, err := VerifyContribution(value)
	if err != nil {
		return nil, err
	}
	b := cert["body"].(map[string]any)
	expected, err := contributionTarget(context.Target)
	if err != nil {
		return nil, err
	}
	if now < 0 || now > MaxSequence || context.SnapshotExpires < 0 || context.SnapshotExpires > MaxSequence {
		return nil, contributionError()
	}
	a, _ := core.Canonical(b["target"])
	e, _ := core.Canonical(expected)
	if string(a) != string(e) {
		return nil, contributionError()
	}
	form, table, err := BindSiteForm(context.Form, context.Table)
	if err != nil {
		return nil, err
	}
	hash, err := ContributionSchemaHash(form, table)
	if err != nil || hash != b["schemaHash"] {
		return nil, contributionError()
	}
	if _, err = MatchContributionValues(form, table, b["values"]); err != nil {
		return nil, err
	}
	public, readers, err := resourceScope(context.SiteScope)
	if err != nil {
		return nil, err
	}
	author := b["contributor"].(map[string]any)["id"].(string)
	owner, _, _ := ParseAddress(expected["site"].(string))
	if !public && (!docContains(readers, owner) || !docContains(readers, author)) {
		return nil, contributionError()
	}
	if form["contributors"] != "readers" {
		_, allowed, err := resourceScope(form["contributors"])
		if err != nil || !docContains(allowed, author) {
			return nil, contributionError()
		}
	}
	created, _ := docNumber(b["created"])
	expires, _ := docNumber(b["expires"])
	if created-now > ContributionClockSkewMS || expires <= now || expires > context.SnapshotExpires {
		return nil, contributionError()
	}
	covers, err := ResourceScopeCoversSite(context.SiteScope, b["publicationScope"])
	if err != nil || !covers {
		return nil, contributionError()
	}
	return cert, nil
}
