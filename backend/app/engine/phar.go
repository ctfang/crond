package engine

import (
	"bytes"
	"compress/bzip2"
	"compress/flate"
	"crypto/md5"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/binary"
	"fmt"
	"hash"
	"hash/crc32"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const pharLimit = 64 << 20

func IsPhar(name string) bool {
	file, err := os.Open(name)
	if err != nil {
		return false
	}
	defer file.Close()
	header := make([]byte, 8192)
	n, _ := file.Read(header)
	return bytes.Contains(header[:n], []byte("__HALT_COMPILER();"))
}

type pharEntry struct {
	name                         string
	size, compressed, crc, flags uint32
}

func pharWord(reader *bytes.Reader) (uint32, error) {
	var value uint32
	err := binary.Read(reader, binary.LittleEndian, &value)
	return value, err
}
func pharSkip(reader *bytes.Reader, size uint32) error {
	if uint64(size) > uint64(reader.Len()) {
		return io.ErrUnexpectedEOF
	}
	_, err := reader.Seek(int64(size), io.SeekCurrent)
	return err
}

// ExtractPhar reads the native PHAR manifest without evaluating its PHP stub or metadata.
// Bounds, per-file CRC and supported archive signatures are checked before execution.
func ExtractPhar(name string) (directory string, err error) {
	file, err := os.Open(name)
	if err != nil {
		return "", err
	}
	defer file.Close()
	archive, err := io.ReadAll(io.LimitReader(file, pharLimit+1))
	if err != nil {
		return "", err
	}
	if len(archive) > pharLimit {
		return "", fmt.Errorf("PHAR 超过 64 MiB")
	}
	marker := []byte("__HALT_COMPILER();")
	stub := bytes.Index(archive, marker)
	if stub < 0 {
		return "", fmt.Errorf("不是原生 PHAR 文件")
	}
	offset := stub + len(marker)
	if bytes.HasPrefix(archive[offset:], []byte(" ?>")) {
		offset += 3
	}
	if bytes.HasPrefix(archive[offset:], []byte("\r\n")) {
		offset += 2
	} else if bytes.HasPrefix(archive[offset:], []byte("\n")) {
		offset++
	}
	if offset+4 > len(archive) {
		return "", io.ErrUnexpectedEOF
	}
	manifestSize := binary.LittleEndian.Uint32(archive[offset:])
	offset += 4
	if manifestSize > 1<<20 || uint64(offset)+uint64(manifestSize) > uint64(len(archive)) {
		return "", fmt.Errorf("无效 PHAR manifest")
	}
	reader := bytes.NewReader(archive[offset : offset+int(manifestSize)])
	count, err := pharWord(reader)
	if err != nil {
		return "", err
	}
	if count > 65536 {
		return "", fmt.Errorf("PHAR 文件数量过多")
	}
	if _, err = reader.Seek(2, io.SeekCurrent); err != nil {
		return "", err
	}
	globalFlags, err := pharWord(reader)
	if err != nil {
		return "", err
	}
	aliasSize, err := pharWord(reader)
	if err != nil {
		return "", err
	}
	if err = pharSkip(reader, aliasSize); err != nil {
		return "", err
	}
	metadataSize, err := pharWord(reader)
	if err != nil {
		return "", err
	}
	if err = pharSkip(reader, metadataSize); err != nil {
		return "", err
	}
	entries := []pharEntry{}
	names := map[string]bool{}
	var total uint64
	for i := uint32(0); i < count; i++ {
		length, err := pharWord(reader)
		if err != nil {
			return "", err
		}
		if length == 0 || length > 4096 || length > uint32(reader.Len()) {
			return "", fmt.Errorf("无效 PHAR 文件名")
		}
		raw := make([]byte, length)
		if _, err = io.ReadFull(reader, raw); err != nil {
			return "", err
		}
		name := string(raw)
		clean := path.Clean(name)
		if path.IsAbs(name) || strings.ContainsAny(name, "\\\x00") || clean == ".." || strings.HasPrefix(clean, "../") || clean == "." || names[strings.ToLower(clean)] {
			return "", fmt.Errorf("不安全或重复 PHAR 路径: %s", name)
		}
		names[strings.ToLower(clean)] = true
		fields := [6]uint32{}
		if err = binary.Read(reader, binary.LittleEndian, &fields); err != nil {
			return "", err
		}
		if err = pharSkip(reader, fields[5]); err != nil {
			return "", err
		}
		total += uint64(fields[0])
		if total > 256<<20 {
			return "", fmt.Errorf("PHAR 解压超过 256 MiB")
		}
		entries = append(entries, pharEntry{name: name, size: fields[0], compressed: fields[2], crc: fields[3], flags: fields[4]})
	}
	contentEnd := len(archive)
	if globalFlags&0x10000 != 0 {
		if contentEnd < 8 || string(archive[contentEnd-4:]) != "GBMB" {
			return "", fmt.Errorf("PHAR 签名缺失")
		}
		signatureType := binary.LittleEndian.Uint32(archive[contentEnd-8:])
		var digest hash.Hash
		switch signatureType {
		case 1:
			digest = md5.New()
		case 2:
			digest = sha1.New()
		case 3:
			digest = sha256.New()
		case 4:
			digest = sha512.New()
		default:
			return "", fmt.Errorf("不支持的 PHAR 签名类型: %d", signatureType)
		}
		signatureStart := contentEnd - 8 - digest.Size()
		if signatureStart < 0 {
			return "", io.ErrUnexpectedEOF
		}
		digest.Write(archive[:signatureStart])
		if !bytes.Equal(digest.Sum(nil), archive[signatureStart:contentEnd-8]) {
			return "", fmt.Errorf("PHAR 签名校验失败")
		}
		contentEnd = signatureStart
	}
	directory, err = os.MkdirTemp("", "crond-phar-")
	if err != nil {
		return "", err
	}
	createdDirectory := directory
	defer func() {
		if err != nil {
			os.RemoveAll(createdDirectory)
		}
	}()
	position := offset + int(manifestSize)
	for _, entry := range entries {
		if uint64(position)+uint64(entry.compressed) > uint64(contentEnd) {
			return "", io.ErrUnexpectedEOF
		}
		raw := archive[position : position+int(entry.compressed)]
		position += int(entry.compressed)
		var content io.Reader = bytes.NewReader(raw)
		var closer io.Closer
		switch entry.flags & 0x3000 {
		case 0x1000:
			inflater := flate.NewReader(content)
			content = inflater
			closer = inflater
		case 0x2000:
			content = bzip2.NewReader(content)
		case 0x3000:
			return "", fmt.Errorf("无效 PHAR 压缩标志")
		}
		data, readErr := io.ReadAll(io.LimitReader(content, int64(entry.size)+1))
		if closer != nil {
			closer.Close()
		}
		if readErr != nil {
			return "", readErr
		}
		if len(data) != int(entry.size) || crc32.ChecksumIEEE(data) != entry.crc {
			return "", fmt.Errorf("PHAR 文件校验失败: %s", entry.name)
		}
		target := filepath.Join(directory, filepath.FromSlash(entry.name))
		if strings.HasSuffix(entry.name, "/") {
			err = os.MkdirAll(target, 0700)
		} else {
			err = os.MkdirAll(filepath.Dir(target), 0700)
			if err == nil {
				err = os.WriteFile(target, data, 0600)
			}
		}
		if err != nil {
			return "", err
		}
	}
	if position != contentEnd {
		return "", fmt.Errorf("PHAR 内容长度不匹配")
	}
	return directory, nil
}
