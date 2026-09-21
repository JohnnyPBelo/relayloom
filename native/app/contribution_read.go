package app

import (
	"errors"
	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/sites"
	"time"
)

func (n *Node) contributionFormLocked(body map[string]any) (any, error) {
	lookup, err := sites.ParseContributionFormLookup(body)
	if err != nil {
		return nil, err
	}
	if n.identity == nil {
		return nil, errors.New("desbloqueie a identidade")
	}
	if _, err = n.objectsLocked(); err != nil {
		return nil, err
	}
	bundle, err := n.Store.GetWithTouch(text(lookup["snapshotId"]), false)
	if err != nil {
		return nil, err
	}
	if contains(n.config.Blocked, bundle.Manifest.Author.ID) {
		return nil, errors.New("autor do site bloqueado")
	}
	if m, ok := n.private.Mutations[bundle.Manifest.ID]; ok && m.Author == bundle.Manifest.Author.ID && m.Deleted && m.Expires > time.Now().UnixMilli() {
		return nil, errors.New("o autor retirou este snapshot")
	}
	value, err := core.DecryptBundle(bundle, n.identity)
	if err != nil {
		return nil, err
	}
	found, err := sites.ResolveContributionForm(lookup, bundle, value, n.identity.Public.ID, time.Now().UnixMilli())
	if err != nil {
		return nil, err
	}
	return sites.DescribeContributionForm(found)
}
