require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// IMPORTANT: Update with your actual MySQL password
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD, // <-- Change this
    database: 'campus_bazaar'
});

db.connect((err) => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to MySQL Database.');
});

// --- AUTHENTICATION ROUTES ---

// Sign Up Route
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    
    // Extract the domain (e.g., "@ce.du.ac.in") from the email
    const domain = email.substring(email.lastIndexOf('@'));

    // Check if the domain is approved in the Institutions table
    db.query('SELECT InstitutionID FROM Institutions WHERE EmailDomain = ?', [domain], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        if (results.length === 0) {
            return res.status(400).json({ error: 'Invalid Institutional Email. Domain not recognized.' });
        }

        const institutionId = results[0].InstitutionID;
        
        // Hash the password securely
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save the new user to the database
        const query = 'INSERT INTO Users (Name, Email, PasswordHash, InstitutionID) VALUES (?, ?, ?, ?)';
        db.query(query, [name, email, hashedPassword, institutionId], (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({ error: 'Email already registered.' });
                }
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, message: 'Account created successfully! You can now login.' });
        });
    });
});

// Login Route
app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT * FROM Users WHERE Email = ?', [email], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        if (results.length === 0) {
            return res.status(400).json({ error: 'Email not found.' });
        }

        const user = results[0];
        
        // Compare the submitted password with the hashed password in the DB
        const isMatch = await bcrypt.compare(password, user.PasswordHash);
        
        if (!isMatch) {
            return res.status(400).json({ error: 'Incorrect password.' });
        }

        res.json({ success: true, message: 'Login successful!' });
    });
});

// Page Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});