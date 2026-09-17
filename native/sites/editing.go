package sites

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

// ValidateEditingContext checks local encrypted draft metadata. It is not an
// authorization certificate and never bypasses the publication catalog's CAS.
func ValidateEditingContext(value any, owner string) error {
	m, err := shapeOptional(value, []string{"domain", "address", "base", "sequence", "recipients", "ttlMs"}, "pending")
	if err != nil {
		return err
	}
	address, ok := m["address"].(string)
	if !ok {
		return errors.New("contexto do rascunho inválido")
	}
	parsedOwner, _, err := ParseAddress(address)
	sequence, numberErr := docNumber(m["sequence"])
	if err != nil || numberErr != nil || !core.ValidAddress(owner) || parsedOwner != owner || m["domain"] != "relayloom/site-editing/1" || !core.ValidAddress(docTextValue(m["base"])) || sequence < 1 || sequence > MaxSequence {
		return errors.New("contexto do rascunho inválido")
	}
	ttl, err := docNumber(m["ttlMs"])
	if err != nil || ttl < 1000 || ttl > 365*86400000 {
		return errors.New("prazo do rascunho inválido")
	}
	if m["recipients"] != "public" {
		ids, err := recordStrings(m["recipients"], 63)
		if err != nil || !validIDs(ids, 63) {
			return errors.New("leitores do rascunho inválidos")
		}
		for _, id := range ids {
			if id == owner {
				return errors.New("o proprietário já pode ler o próprio site")
			}
		}
	}
	if raw, exists := m["pending"]; exists {
		p, err := shapeOptional(raw, []string{"operationId", "requestHash"}, "confirmedHeads")
		if err != nil {
			return err
		}
		if !operationPattern.MatchString(docTextValue(p["operationId"])) || !core.ValidAddress(docTextValue(p["requestHash"])) {
			return errors.New("pedido pendente do rascunho inválido")
		}
		if heads, exists := p["confirmedHeads"]; exists {
			ids, err := recordStrings(heads, RegistryHeaders)
			if err != nil || len(ids) < 2 || !validIDs(ids, RegistryHeaders) {
				return errors.New("confirmação das versões concorrentes inválida")
			}
		}
	}
	_, err = core.Canonical(value)
	return err
}
