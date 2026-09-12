package groupauthority

import (
	"errors"

	"github.com/JohnnyPBelo/relayloom/native/core"
	"github.com/JohnnyPBelo/relayloom/native/groupstore"
)

type ProofRejection struct {
	GroupID  string `json:"groupId"`
	Accepted int    `json:"accepted"`
	Message  string `json:"message"`
}

type borrowedStore struct {
	tx      *groupstore.Tx
	active  bool
	failure error
}

func (s *borrowedStore) execute(callback func(*groupstore.Tx) error) (err error) {
	if !s.active {
		return errors.New("âmbito de autoridade encerrado")
	}
	if s.failure != nil {
		return s.failure
	}
	defer func() {
		if recovered := recover(); recovered != nil {
			s.failure = errors.New("operação de autoridade interrompida")
			panic(recovered)
		}
	}()
	err = callback(s.tx)
	if err != nil {
		s.failure = err
	}
	return err
}
func (s *borrowedStore) View(callback func(*groupstore.Tx) error) error   { return s.execute(callback) }
func (s *borrowedStore) Update(callback func(*groupstore.Tx) error) error { return s.execute(callback) }

// InTransaction borrows the caller's transaction on the same goroutine. It must
// not escape the synchronous callback. Rejected network proof tails are data:
// the caller reconciles admission/outbox and commits the verified restriction
// before reporting rejection. No result authorizes transmission before the
// outer commit succeeds. Any unhandled operation error aborts the whole scope,
// even if the callback tried to swallow that error.
func InTransaction(tx *groupstore.Tx, identity core.Identity, callback func(*Registry) error) (rejections []ProofRejection, err error) {
	scope := &borrowedStore{tx: tx, active: true}
	defer func() {
		scope.active = false
		if recovered := recover(); recovered != nil {
			_ = tx.Abort(errors.New("âmbito de autoridade interrompido"))
			panic(recovered)
		}
		if err != nil {
			err = tx.Abort(err)
		}
	}()
	registry, err := newRegistry(scope, identity)
	if err != nil {
		return nil, err
	}
	rejections = []ProofRejection{}
	registry.rejections = &rejections
	registry.scopeCheck = func() (uint64, error) {
		if !scope.active {
			return 0, errors.New("âmbito de autoridade encerrado")
		}
		return tx.Generation()
	}
	if err := callback(registry); err != nil {
		return nil, err
	}
	if scope.failure != nil {
		return nil, scope.failure
	}
	return rejections, nil
}
