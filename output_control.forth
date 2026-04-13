VARIABLE i 
VARIABLE x 
: main 
10 x ! 
x @ 5 > IF 
S" greater" S" fmt.Println" SCALL 
ELSE 
S" lesser" S" fmt.Println" SCALL 
THEN 
0 i ! 
BEGIN 
i @ 3 < WHILE 
i @ S" fmt.Println" SCALL 
i @ 1 + i ! 
REPEAT 
; 
