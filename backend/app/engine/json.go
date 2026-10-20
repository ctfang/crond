package engine

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strconv"
)

const JSONWorkerFlag = "--crond-json"

// Shell transport uses Go JSON helpers; it never starts native PHP to encode/poll commands.
func RunJSON(args []string) int {
	if len(args) == 2 && args[0] == "command" {
		data, _ := json.Marshal(map[string]string{"command": args[1]})
		fmt.Print(string(data))
		return 0
	}
	if len(args) < 1 {
		return 1
	}
	var response map[string]interface{}
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 2<<20))
	if err := decoder.Decode(&response); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	output, _ := response["output"].(string)
	switch args[0] {
	case "accepted":
		if response["status"] != "running" {
			fmt.Fprintln(os.Stderr, response["error"])
			return 1
		}
	case "output":
		offset := 0
		if len(args) > 1 {
			offset, _ = strconv.Atoi(args[1])
		}
		if offset < 0 {
			offset = 0
		}
		if offset < len(output) {
			fmt.Print(output[offset:])
		}
	case "length":
		fmt.Print(len(output))
	case "status":
		status, _ := response["status"].(string)
		if status == "" {
			status = "error"
		}
		fmt.Print(status)
	default:
		return 1
	}
	return 0
}
