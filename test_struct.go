package main
import "fmt"
type Rect struct {
	Width  int
	Height int
}
func main() {
	var r Rect
	r.Width = 10
	r.Height = 20
	fmt.Println(r.Width * r.Height)
}
