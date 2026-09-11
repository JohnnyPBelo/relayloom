// Package mobile is the bounded gomobile binding surface. The native host owns
// the data and bundled-assets directories; no external daemon is involved.
package mobile

import (
	"errors"
	"runtime"
	"sync"

	"github.com/JohnnyPBelo/relayloom/native/app"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

var mu sync.Mutex
var service *app.Service

func Start(dataDir, assetsPath string) (string, error) {
	mu.Lock()
	defer mu.Unlock()
	if service != nil {
		return "", errors.New("o núcleo local já está iniciado")
	}
	started, err := app.Start(dataDir, assetsPath)
	if err != nil {
		return "", err
	}
	data, err := core.Canonical(map[string]any{"origin": started.Origin, "token": started.Token, "tcpPort": started.Node.TCPPort})
	if err != nil {
		started.Close()
		return "", err
	}
	service = started
	return string(data), nil
}
func Stop() error {
	mu.Lock()
	defer mu.Unlock()
	if service == nil {
		return nil
	}
	err := service.Close()
	service = nil
	return err
}
func Version() string {
	return "relayloom-native-v1;" + runtime.Version() + ";" + runtime.GOOS + "/" + runtime.GOARCH
}
