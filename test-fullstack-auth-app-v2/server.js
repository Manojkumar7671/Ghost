const express = require('express');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const db = require('./db');
const app = express();
const port = 3000;

app.use(express.json());
app.use(express.static('public'));

let dbConnection;

function connectToDatabase() {
    dbConnection = new sqlite3.Database('./test-fullstack-auth-app-v2.db');
    dbConnection.serialize(function() {
        dbConnection.run(`
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL
            );
        `);

        dbConnection.run(`
            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
        `);
    });
}

connectToDatabase();

app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const query = `
        INSERT INTO users (username, password)
        VALUES (?,?);
    `;

    dbConnection.run(query, [username, password], function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                res.status(400).send({ message: 'Username already exists' });
            } else {
                res.status(500).send({ message: 'Internal Server Error' });
            }
        } else {
            res.send({ message: 'User created successfully' });
        }
    });
});

app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const query = `
        SELECT * FROM users
        WHERE username =? AND password =?;
    `;

    dbConnection.get(query, [username, password], (err, row) => {
        if (err) {
            res.status(500).send({ message: 'Internal Server Error' });
        } else if (row) {
            const token = jwt.sign({ userId: row.id }, 'secretkey', { expiresIn: '1h' });
            res.send({ token });
        } else {
            res.status(401).send({ message: 'Invalid username or password' });
        }
    });
});

app.use((req, res, next) => {
    const token = req.header('Authorization');
    if (!token) {
        res.status(401).send({ message: 'Access denied. No token provided.' });
    } else {
        try {
            const decoded = jwt.verify(token, 'secretkey');
            req.user = decoded;
            next();
        } catch (ex) {
            res.status(400).send({ message: 'Invalid token.' });
        }
    }
});

app.get('/notes', (req, res) => {
    const query = `
        SELECT * FROM notes
        WHERE user_id =?;
    `;

    dbConnection.all(query, [req.user.userId], (err, rows) => {
        if (err) {
            res.status(500).send({ message: 'Internal Server Error' });
        } else {
            res.send(rows);
        }
    });
});

app.post('/notes', (req, res) => {
    const { title, content } = req.body;
    const query = `
        INSERT INTO notes (user_id, title, content)
        VALUES (?,?,?);
    `;

    dbConnection.run(query, [req.user.userId, title, content], function(err) {
        if (err) {
            res.status(500).send({ message: 'Internal Server Error' });
        } else {
            res.send({ message: 'Note created successfully' });
        }
    });
});

app.delete('/notes/:id', (req, res) => {
    const id = req.params.id;
    const query = `
        DELETE FROM notes
        WHERE id =? AND user_id =?;
    `;

    dbConnection.run(query, [id, req.user.userId], function(err) {
        if (err) {
            res.status(500).send({ message: 'Internal Server Error' });
        } else {
            res.send({ message: 'Note deleted successfully' });
        }
    });
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});