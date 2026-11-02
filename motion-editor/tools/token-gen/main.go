// Gerador de tokens de acesso do MotionFrame.
// A chave secreta NÃO fica neste código: entra só na hora de compilar (-ldflags "-X main.keyB64=...").
// Quem tiver o .exe consegue gerar tokens — guarde-o só com você (e faça uma cópia de segurança).
package main

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var keyB64 = "" // chave secreta (PKCS#8, base64), injetada na compilação

type payload struct {
	D string `json:"d"`           // código do aparelho
	N string `json:"n"`           // nome da pessoa
	E int64  `json:"e,omitempty"` // validade (unix), 0 = sem validade
	I int64  `json:"i"`           // emitido em (unix)
}

func normCode(s string) string {
	s = strings.ToUpper(s)
	s = regexp.MustCompile(`[^0-9A-Z]`).ReplaceAllString(s, "")
	return strings.TrimPrefix(s, "MF")
}

func makeToken(key *ecdsa.PrivateKey, code, name string, days int) (string, error) {
	p := payload{D: code, N: name, I: time.Now().Unix()}
	if days > 0 {
		p.E = time.Now().Add(time.Duration(days) * 24 * time.Hour).Unix()
	}
	js, _ := json.Marshal(p)
	pb := base64.RawURLEncoding.EncodeToString(js)
	h := sha256.Sum256([]byte(pb))
	r, s, err := ecdsa.Sign(rand.Reader, key, h[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64) // formato IEEE P1363 (r||s), o que o navegador (WebCrypto) espera
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return pb + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

func main() {
	der, err := base64.StdEncoding.DecodeString(keyB64)
	if err != nil || len(der) == 0 {
		fmt.Println("Este gerador foi compilado sem a chave. Use o .exe que você recebeu.")
		fmt.Scanln()
		return
	}
	k, err := x509.ParsePKCS8PrivateKey(der)
	if err != nil {
		fmt.Println("Chave inválida:", err)
		fmt.Scanln()
		return
	}
	key := k.(*ecdsa.PrivateKey)
	in := bufio.NewReader(os.Stdin)
	ask := func(q string) string { fmt.Print(q); s, _ := in.ReadString('\n'); return strings.TrimSpace(s) }
	exe, _ := os.Executable()
	logPath := filepath.Join(filepath.Dir(exe), "tokens-gerados.txt")

	fmt.Println("=== MotionFrame · gerador de tokens de acesso ===")
	fmt.Println("Cada token só funciona no aparelho do código informado.")
	for {
		fmt.Println()
		code := normCode(ask("Código do aparelho (ex.: MF-ABCD-EFGH-JKMN-PQRS): "))
		if len(code) != 16 {
			fmt.Println("Código inválido: precisa ter 16 letras/números depois de MF.")
			continue
		}
		name := ask("Nome da pessoa: ")
		days, _ := strconv.Atoi(ask("Validade em dias (0 = sem validade): "))
		tok, err := makeToken(key, code, name, days)
		if err != nil {
			fmt.Println("Erro:", err)
			continue
		}
		fmt.Println("\nTOKEN (mande para a pessoa):")
		fmt.Println(tok)
		if f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600); err == nil {
			fmt.Fprintf(f, "%s\t%s\tMF-%s\tvalidade %d dias\t%s\n", time.Now().Format("2006-01-02 15:04"), name, code, days, tok)
			f.Close()
			fmt.Println("(salvo também em tokens-gerados.txt)")
		}
		if strings.ToLower(ask("\nGerar outro? (s/n): ")) != "s" {
			return
		}
	}
}
