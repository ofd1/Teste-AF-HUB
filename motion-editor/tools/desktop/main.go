// MotionFrame para Windows (.exe): o editor completo embutido no executável.
// Serve o app em http://127.0.0.1:47821 (porta fixa = projetos e acesso ficam salvos) e abre uma janela própria
// do Microsoft Edge ou do Google Chrome em modo aplicativo (sem barra de endereço). Funciona offline.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"
)

//go:embed all:www
var site embed.FS

const port = "47821"

func main() {
	sub, err := fs.Sub(site, "www")
	if err != nil {
		fail(err)
	}
	mime.AddExtensionType(".mjs", "text/javascript")
	mime.AddExtensionType(".wasm", "application/wasm")
	mime.AddExtensionType(".webmanifest", "application/manifest+json")
	files := http.FileServer(http.FS(sub))
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	})
	url := "http://127.0.0.1:" + port + "/"
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		// já está aberto: só abre outra janela
		openWindow(url)
		return
	}
	go func() { _ = http.Serve(ln, handler) }()
	time.Sleep(150 * time.Millisecond)
	fmt.Println("MotionFrame rodando em", url)
	fmt.Println("Deixe esta janela aberta enquanto usa o editor. Feche-a para encerrar.")
	// o Edge/Chrome pode devolver o controle na hora (se já estiver aberto): o servidor continua até fechar este console
	openWindow(url)
	select {}
}

// openWindow abre o Edge/Chrome em modo app com um perfil próprio (projetos e token ficam guardados nele).
func openWindow(url string) *exec.Cmd {
	profile := filepath.Join(userDir(), "MotionFrame", "perfil")
	_ = os.MkdirAll(profile, 0o755)
	args := []string{"--app=" + url, "--user-data-dir=" + profile, "--window-size=1440,900", "--no-first-run", "--no-default-browser-check",
		"--enable-features=SharedArrayBuffer", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--max-old-space-size=8192"}
	for _, b := range browsers() {
		if _, err := os.Stat(b); err == nil {
			cmd := exec.Command(b, args...)
			if err := cmd.Start(); err == nil {
				return cmd
			}
		}
	}
	// sem Edge/Chrome: abre no navegador padrão
	switch runtime.GOOS {
	case "windows":
		_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		_ = exec.Command("open", url).Start()
	default:
		_ = exec.Command("xdg-open", url).Start()
	}
	return nil
}

func browsers() []string {
	if runtime.GOOS != "windows" {
		return []string{"/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/microsoft-edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
	}
	var out []string
	for _, base := range []string{os.Getenv("ProgramFiles(x86)"), os.Getenv("ProgramFiles"), os.Getenv("LocalAppData")} {
		if base == "" {
			continue
		}
		out = append(out,
			filepath.Join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(base, "Google", "Chrome", "Application", "chrome.exe"))
	}
	return out
}

func userDir() string {
	if d := os.Getenv("LocalAppData"); d != "" {
		return d
	}
	if d, err := os.UserConfigDir(); err == nil {
		return d
	}
	return os.TempDir()
}

func fail(err error) {
	fmt.Println("Erro:", err)
	if runtime.GOOS == "windows" {
		fmt.Println("Pressione Enter para sair.")
		fmt.Scanln()
	}
	os.Exit(1)
}

