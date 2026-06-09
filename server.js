const express = require('express');
const app = express();

app.use(express.json());

app.post('/', (req, res) => {
    console.log("Ghost received:", req.body);
    res.status(200).json({ status: "success" });
});

app.listen(3000, () => {
    console.log('Ghost server is running on port 3000');
});
