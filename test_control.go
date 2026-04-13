package main
import "fmt"
func main() {
    var x = 10
    if x > 5 {
        fmt.Println("greater")
    } else {
        fmt.Println("lesser")
    }
    for i := 0; i < 3; i++ {
        fmt.Println(i)
    }
}
