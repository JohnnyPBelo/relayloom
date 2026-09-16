package app

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/JohnnyPBelo/relayloom/native/core"
)

type Options struct {
	HTTPPort int
	TCPPort  int
	TCPHost  string
}
type Service struct {
	Node     *Node
	Origin   string
	Token    string
	server   *http.Server
	assets   *os.Root
	close    sync.Once
	closeErr error
}

func Start(dataDir, assetsPath string) (*Service, error) {
	return StartWithOptions(dataDir, assetsPath, Options{})
}
func StartWithOptions(dataDir, assetsPath string, options Options) (*Service, error) {
	if options.HTTPPort < 0 || options.HTTPPort > 65535 {
		return nil, errors.New("porta HTTP inválida")
	}
	assets, err := os.OpenRoot(assetsPath)
	if err != nil {
		return nil, fmt.Errorf("recursos locais indisponíveis: %w", err)
	}
	index, err := assets.Stat("index.html")
	if err != nil || !index.Mode().IsRegular() {
		assets.Close()
		return nil, errors.New("compile e inclua a interface local antes de iniciar")
	}
	node, err := NewNode(dataDir)
	if err != nil {
		assets.Close()
		return nil, err
	}
	if err = node.Start(options.TCPPort, options.TCPHost); err != nil {
		node.Close()
		assets.Close()
		return nil, err
	}
	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(options.HTTPPort)))
	if err != nil {
		node.Close()
		assets.Close()
		return nil, err
	}
	random := make([]byte, 32)
	if _, err = rand.Read(random); err != nil {
		listener.Close()
		node.Close()
		assets.Close()
		return nil, err
	}
	service := &Service{Node: node, Origin: "http://" + listener.Addr().String(), Token: hex.EncodeToString(random), assets: assets}
	expectedHost := listener.Addr().String()
	var rateMu sync.Mutex
	rateStart := time.Now()
	rateCount := 0
	var connectionsMu sync.Mutex
	connections := map[net.Conn]bool{}
	service.server = &http.Server{ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 32 * 1024, ConnState: func(c net.Conn, state http.ConnState) {
		connectionsMu.Lock()
		defer connectionsMu.Unlock()
		if state == http.StateNew {
			if len(connections) >= 64 {
				c.Close()
				return
			}
			connections[c] = true
		}
		if state == http.StateClosed || state == http.StateHijacked {
			delete(connections, c)
		}
	}}
	service.server.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		if r.Host != expectedHost || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != service.Origin) {
			respond(w, 403, map[string]any{"error": "origem não autorizada"})
			return
		}
		if len(r.Header) > 40 {
			respond(w, 431, map[string]any{"error": "demasiados cabeçalhos"})
			return
		}
		requestPath, err := url.PathUnescape(r.URL.EscapedPath())
		if err != nil {
			respond(w, 400, map[string]any{"error": "endereço inválido"})
			return
		}
		if strings.HasPrefix(requestPath, "/api/") {
			if !core.ConstantEqual(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), service.Token) {
				respond(w, 401, map[string]any{"error": "sessão local inválida; abra o endereço de arranque deste nó"})
				return
			}
			rateMu.Lock()
			if time.Since(rateStart) >= time.Second {
				rateStart = time.Now()
				rateCount = 0
			}
			rateCount++
			limited := rateCount > 60
			rateMu.Unlock()
			if limited {
				respond(w, 429, map[string]any{"error": "demasiados pedidos; tente novamente"})
				return
			}
			operation := strings.TrimPrefix(requestPath, "/api/")
			if r.Method == http.MethodGet && operation == "ui-preferences" {
				prefs, err := node.UIPreferences()
				if err != nil {
					respond(w, 400, map[string]any{"error": err.Error()})
				} else {
					respond(w, 200, prefs)
				}
				return
			}
			if r.Method == http.MethodGet && operation == "state" {
				state, err := node.State()
				if err != nil {
					respond(w, 400, map[string]any{"error": err.Error()})
					return
				}
				respond(w, 200, state)
				return
			}
			if r.Method != http.MethodPost {
				respond(w, 405, map[string]any{"error": "método inválido"})
				return
			}
			if r.Header.Get("Content-Type") != "application/json" {
				respond(w, 415, map[string]any{"error": "apenas JSON"})
				return
			}
			r.Body = http.MaxBytesReader(w, r.Body, 6*1024*1024)
			data, err := io.ReadAll(r.Body)
			if err != nil {
				var tooLarge *http.MaxBytesError
				if errors.As(err, &tooLarge) {
					respond(w, 413, map[string]any{"error": "pedido demasiado grande"})
				} else {
					respond(w, 400, map[string]any{"error": "pedido inválido"})
				}
				return
			}
			value, err := core.DecodeJSON(data, 6*1024*1024)
			if err != nil {
				respond(w, 400, map[string]any{"error": err.Error()})
				return
			}
			body, err := object(value)
			if err != nil {
				respond(w, 400, map[string]any{"error": err.Error()})
				return
			}
			if !contains([]string{"ui-preferences", "setup", "unlock", "lock", "export", "contact", "connect", "web-peer", "web-peer-stop", "serial", "site-draft", "site-draft-load", "collection", "retrieve", "publish", "send", "outbox-retry", "group-command", "action", "settings", "view", "history", "attachment"}, operation) {
				respond(w, 404, map[string]any{"error": "operação desconhecida"})
				return
			}
			result, err := node.Handle(operation, body)
			if err != nil {
				status := 400
				if operation == "serial" {
					status = 501
				}
				respond(w, status, map[string]any{"error": err.Error()})
				return
			}
			respond(w, 200, result)
			return
		}
		if r.Method != http.MethodGet {
			w.WriteHeader(405)
			return
		}
		relative := strings.TrimPrefix(path.Clean("/"+requestPath), "/")
		if relative == "." || relative == "" {
			relative = "index.html"
		}
		file, err := assets.Open(relative)
		if err == nil {
			info, e := file.Stat()
			if e != nil || !info.Mode().IsRegular() || filepath.Ext(relative) == "" {
				file.Close()
				file = nil
				err = os.ErrNotExist
			}
		}
		if err != nil {
			relative = "index.html"
			file, err = assets.Open(relative)
		}
		if err != nil {
			respond(w, 503, map[string]any{"error": "interface local indisponível"})
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || info.Size() > 8*1024*1024 {
			respond(w, 503, map[string]any{"error": "recurso local inválido"})
			return
		}
		contentType := mime.TypeByExtension(filepath.Ext(relative))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)
		if filepath.Ext(relative) == ".html" {
			w.Header().Set("Cache-Control", "no-cache")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=3600")
		}
		http.ServeContent(w, r, relative, info.ModTime(), file)
	})
	go func() { _ = service.server.Serve(listener) }()
	return service, nil
}
func respond(w http.ResponseWriter, status int, value any) {
	data, err := core.Canonical(value)
	if err != nil {
		status = 500
		data = []byte(`{"error":"resposta inválida"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write(data)
}
func (s *Service) Close() error {
	s.close.Do(func() {
		serverErr := s.server.Close()
		nodeErr := s.Node.Close()
		assetsErr := s.assets.Close()
		if serverErr != nil && !errors.Is(serverErr, http.ErrServerClosed) {
			s.closeErr = serverErr
		} else if nodeErr != nil {
			s.closeErr = nodeErr
		} else {
			s.closeErr = assetsErr
		}
	})
	return s.closeErr
}
