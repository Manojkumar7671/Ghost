class ListNode {
    constructor(val = 0, next = null) {
        this.val = val;
        this.next = next;
    }
}

function reverseList(head) {
    let prev = null;
    let curr = head;
    while (curr) {
        let nextNode = curr.next;
        curr.next = prev;
        prev = curr;
        curr = nextNode;
    }
    return prev;
}

function printList(head) {
    while (head) {
        process.stdout.write(head.val + ' ');
        head = head.next;
    }
    console.log();
}

// Create a list 1->2->3->4->5
let head = new ListNode(1, new ListNode(2, new ListNode(3, new ListNode(4, new ListNode(5)))));

// Reverse the list
head = reverseList(head);

// Print the values
printList(head);  // Output: 5 4 3 2 1