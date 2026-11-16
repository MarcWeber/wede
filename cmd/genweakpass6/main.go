// genweakpass6 reads a newline-separated list of 6-character chunks (one per
// line), builds a Bloom filter, and writes the binary blob to stdout (or to a
// file given as the second argument).
//
// Usage:
//
//	genweakpass6 <chunks.txt> [output.bin]
//
// The false-positive rate defaults to 1% (9.59 bits per element).
// Pass -fp 0.001 for 0.1% FP, etc.
package main

import (
	"bufio"
	"flag"
	"fmt"
	"math"
	"os"
)

func main() {
	fpFlag := flag.Float64("fp", 0.01, "false-positive rate (default 0.01 = 1%)")
	flag.Parse()
	args := flag.Args()
	if len(args) < 1 {
		fmt.Fprintln(os.Stderr, "usage: genweakpass6 <chunks.txt> [output.bin]")
		os.Exit(1)
	}
	inFile := args[0]
	outFile := ""
	if len(args) > 1 {
		outFile = args[1]
	}

	// Read 6-char chunks, one per line.
	chunks := make(map[string]struct{})
	f, err := os.Open(inFile)
	if err != nil {
		fmt.Fprintf(os.Stderr, "open %s: %v\n", inFile, err)
		os.Exit(1)
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	buf := make([]byte, 0, 1024)
	scanner.Buffer(buf, 1024*1024)
	lines := 0
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) == 0 {
			continue
		}
		lines++
		chunks[line] = struct{}{}
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "scan: %v\n", err)
		os.Exit(1)
	}

	n := len(chunks)
	if n == 0 {
		fmt.Fprintln(os.Stderr, "no chunks found")
		os.Exit(1)
	}

	// Calculate Bloom filter size.
	p := *fpFlag
	mBits := int(math.Ceil(-float64(n) * math.Log(p) / (math.Log(2) * math.Log(2))))
	k := int(math.Ceil(math.Log2(1 / p)))
	if k < 1 {
		k = 1
	}

	fmt.Fprintf(os.Stderr, "Lines read: %d\n", lines)
	fmt.Fprintf(os.Stderr, "Unique chunks: %d\n", n)
	fmt.Fprintf(os.Stderr, "Bloom filter: m=%d bits (%.1f KiB), k=%d hashes, fp=%.2f%%\n",
		mBits, float64(mBits)/8/1024, k, p*100)

	// Build bit array.
	bits := make([]byte, (mBits+7)/8)
	for chunk := range chunks {
		h := hash64(chunk)
		h1 := h
		h2 := (h >> 32) | 1
		for i := 0; i < k; i++ {
			idx := (h1 + uint64(i)*h2) % uint64(mBits)
			bits[idx/8] |= 1 << (idx % 8)
		}
	}

	// Write binary format: [4 bytes k][4 bytes m][bits...].
	out := make([]byte, 0, 8+len(bits))
	out = append(out, byte(k>>24), byte(k>>16), byte(k>>8), byte(k))
	out = append(out, byte(mBits>>24), byte(mBits>>16), byte(mBits>>8), byte(mBits))
	out = append(out, bits...)

	if outFile == "" {
		_, err = os.Stdout.Write(out)
	} else {
		err = os.WriteFile(outFile, out, 0644)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "write: %v\n", err)
		os.Exit(1)
	}
	if outFile != "" {
		fmt.Fprintf(os.Stderr, "Wrote %d bytes to %s\n", len(out), outFile)
	}
}

func hash64(s string) uint64 {
	const (
		offset64 = 14695981039346656037
		prime64  = 1099511628211
	)
	h := uint64(offset64)
	for i := 0; i < len(s); i++ {
		h ^= uint64(s[i])
		h *= prime64
	}
	h ^= h >> 30
	h *= 0xbf58476d1ce4e5b9
	h ^= h >> 27
	h *= 0x94d049bb133111eb
	h ^= h >> 31
	return h
}
