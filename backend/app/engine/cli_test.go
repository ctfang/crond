package engine

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && os.Args[1] == CLIWorkerFlag {
		os.Exit(RunCLI(os.Args[2:]))
	}
	if len(os.Args) > 1 && os.Args[1] == JSONWorkerFlag {
		os.Exit(RunJSON(os.Args[2:]))
	}
	os.Exit(m.Run())
}
func TestOrigamiPHPCLIWithoutNativePHP(t *testing.T) {
	executable, _ := os.Executable()
	directory := t.TempDir()
	nativeMarker := filepath.Join(directory, "native-php-called")
	os.WriteFile(filepath.Join(directory, "php"), []byte("#!/bin/sh\ntouch "+nativeMarker+"\nexit 77\n"), 0700)
	script := filepath.Join(directory, "args.php")
	os.WriteFile(script, []byte("<?php echo $argv[1], ':', $argc, PHP_EOL;"), 0600)
	for _, args := range [][]string{{"-r", "$value=3; echo $value, PHP_EOL;"}, {script, "arg with spaces"}, {"-v"}} {
		command := exec.Command(executable, append([]string{CLIWorkerFlag}, args...)...)
		command.Env = []string{"PATH=" + directory}
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatal(string(output), err)
		}
		if args[0] == "-r" && string(output) != "3\n" {
			t.Fatal(string(output))
		}
		if args[0] == script && string(output) != "arg with spaces:2\n" {
			t.Fatal(string(output))
		}
		if args[0] == "-v" && !strings.Contains(string(output), "Origami") {
			t.Fatal(string(output))
		}
	}
	if _, err := os.Stat(nativeMarker); !os.IsNotExist(err) {
		t.Fatal("native PHP was invoked")
	}
}
func nativePhar(t *testing.T, name, source string) string {
	t.Helper()
	manifest := &bytes.Buffer{}
	write := func(value uint32) { binary.Write(manifest, binary.LittleEndian, value) }
	write(1)
	binary.Write(manifest, binary.BigEndian, uint16(0x0011))
	write(0)
	write(0)
	write(0)
	write(uint32(len(name)))
	manifest.WriteString(name)
	payload := []byte(source)
	for _, value := range []uint32{uint32(len(payload)), 0, uint32(len(payload)), crc32.ChecksumIEEE(payload), 0600, 0} {
		write(value)
	}
	archive := &bytes.Buffer{}
	archive.WriteString("<?php __HALT_COMPILER(); ?>\r\n")
	binary.Write(archive, binary.LittleEndian, uint32(manifest.Len()))
	archive.Write(manifest.Bytes())
	archive.Write(payload)
	phar := filepath.Join(t.TempDir(), "composer.phar")
	os.WriteFile(phar, archive.Bytes(), 0600)
	return phar
}
func TestPHARManifestValidationAndCLIExecution(t *testing.T) {
	phar := nativePhar(t, "bin/composer", "<?php echo 'phar-via-origami:', $argv[1], PHP_EOL; exit(0);")
	directory, err := ExtractPhar(phar)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(directory)
	executable, _ := os.Executable()
	command := exec.Command(executable, CLIWorkerFlag, phar, "--version")
	command.Env = []string{"PATH=" + t.TempDir()}
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "phar-via-origami:--version") {
		t.Fatal(string(output), err)
	}
	for _, name := range []string{"../escape.php", "/absolute.php", "safe/../../escape.php"} {
		if directory, err := ExtractPhar(nativePhar(t, name, "<?php echo 1;")); err == nil {
			os.RemoveAll(directory)
			t.Fatal("unsafe path accepted", name)
		}
	}
	data, _ := os.ReadFile(phar)
	data[len(data)-2] ^= 0xff
	os.WriteFile(phar, data, 0600)
	if directory, err := ExtractPhar(phar); err == nil {
		os.RemoveAll(directory)
		t.Fatal("invalid CRC accepted")
	}
}
func TestRealComposerPHARVersion(t *testing.T) {
	phar, err := filepath.Abs("../../data/tools/composer.phar")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(phar); os.IsNotExist(err) {
		t.Skip("Composer PHAR not provided")
	}
	executable, _ := os.Executable()
	command := exec.Command(executable, CLIWorkerFlag, phar, "--version")
	command.Env = []string{"PATH=" + t.TempDir()}
	output, err := command.CombinedOutput()
	if err != nil || !strings.Contains(string(output), "Composer version") {
		t.Fatal(string(output), err)
	}
}
