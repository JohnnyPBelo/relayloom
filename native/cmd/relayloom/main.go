// The CLI is a development/integration host for the same engine embedded on
// mobile. Only this executable owns process signals/exits; mobile never exits.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/JohnnyPBelo/relayloom/native/app"
	"github.com/JohnnyPBelo/relayloom/native/core"
)

func main() {
	data := flag.String("data", ".runtime/native/default", "owned persistent data directory")
	assets := flag.String("assets", "dist/web", "bundled web assets directory")
	httpPort := flag.Int("http-port", 0, "loopback HTTP port")
	tcpPort := flag.Int("tcp-port", 0, "TCP peer port, or -1 for outbound-only")
	tcpHost := flag.String("tcp-host", "127.0.0.1", "TCP peer listen address")
	flag.Parse()
	service, err := app.StartWithOptions(*data, *assets, app.Options{HTTPPort: *httpPort, TCPPort: *tcpPort, TCPHost: *tcpHost})
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	bootstrap, err := core.Canonical(map[string]any{"ready": true, "url": service.Origin, "origin": service.Origin, "token": service.Token, "tcpPort": service.Node.TCPPort})
	if err != nil {
		service.Close()
		fmt.Fprintln(os.Stderr, "bootstrap failed")
		os.Exit(1)
	}
	fmt.Println(string(bootstrap))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	if err = service.Close(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
