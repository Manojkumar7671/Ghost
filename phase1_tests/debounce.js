function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        timeoutId = setTimeout(() => {
            fn(...args);
        }, delay);
    };
}

function testDebounce() {
    const debouncedFunction = debounce(() => console.log('Hello, World!'), 100);
    for (let i = 0; i < 5; i++) {
        debouncedFunction();
    }
}

testDebounce();