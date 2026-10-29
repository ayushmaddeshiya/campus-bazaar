const express = require('express');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database Connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: process.env.DB_PASSWORD,
    database: 'campus_bazaar'
});

db.connect((err) => {
    if (err) console.error('Database connection failed:', err);
    else console.log('Connected to MySQL Database.');
});

// --- SECURITY MIDDLEWARE ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ error: 'Access denied. Please log in.' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid or expired token. Please log in again.' });
        req.user = user; 
        next(); 
    });
}

// --- MULTER CONFIGURATION ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); 
    }
});
const upload = multer({ storage: storage });

// --- AUTHENTICATION ROUTES ---
app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    const domain = email.substring(email.lastIndexOf('@')).toLowerCase().trim();

    db.query('SELECT InstitutionID FROM Institutions WHERE EmailDomain = ?', [domain], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        
        if (results.length === 0) {
            return res.status(400).json({ error: 'Invalid Institutional Email. Domain not recognized.' });
        }

        const institutionId = results[0].InstitutionID;
        const hashedPassword = await bcrypt.hash(password, 10);

        const query = 'INSERT INTO Users (Name, Email, PasswordHash, InstitutionID) VALUES (?, ?, ?, ?)';
        db.query(query, [name, email, hashedPassword, institutionId], (err) => {
            if (err) {
                if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Email already registered.' });
                return res.status(500).json({ error: 'Database error' });
            }
            res.json({ success: true, message: 'Account created successfully!' });
        });
    });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;

    db.query('SELECT * FROM Users WHERE Email = ?', [email], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (results.length === 0) return res.status(400).json({ error: 'Email not found.' });

        const user = results[0];
        const isMatch = await bcrypt.compare(password, user.PasswordHash);
        
        if (!isMatch) return res.status(400).json({ error: 'Incorrect password.' });

        const token = jwt.sign(
            { userId: user.UserID, name: user.Name, email: user.Email },
            process.env.JWT_SECRET,
            { expiresIn: '24h' } 
        );

        res.json({ success: true, message: 'Login successful!', token, user: { name: user.Name, email: user.Email } });
    });
});

// --- PROTECTED API ROUTES ---
app.get('/api/auth/me', authenticateToken, (req, res) => {
    res.json({ user: req.user });
});

app.post('/api/products', authenticateToken, upload.single('productImage'), (req, res) => {
    const { 
        categoryId, productName, description, purchaseDateApprox, 
        usageDuration, sellingPrice, conditionStatus, defectDetails 
    } = req.body;
    
    const sellerId = req.user.userId; 
    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    if (!imagePath) return res.status(400).json({ error: 'Please upload an image.' });

    const insertProductQuery = `
        INSERT INTO Products 
        (SellerID, CategoryID, ProductName, Description, PurchaseDateApprox, UsageDuration, SellingPrice, ConditionStatus, DefectDetails) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.query(insertProductQuery, [
        sellerId, categoryId, productName, description, purchaseDateApprox, 
        usageDuration, sellingPrice, conditionStatus, defectDetails
    ], (err, productResult) => {
        if (err) {
            console.error('Database error on Products:', err);
            return res.status(500).json({ error: 'Failed to save product details.' });
        }

        const newProductId = productResult.insertId;
        const insertImageQuery = `INSERT INTO ProductImages (ProductID, ImagePath) VALUES (?, ?)`;
        
        db.query(insertImageQuery, [newProductId, imagePath], (err, imageResult) => {
            if (err) {
                console.error('Database error on ProductImages:', err);
                return res.status(500).json({ error: 'Product saved, but image linking failed.' });
            }
            res.json({ success: true, message: 'Item listed successfully!' });
        });
    });
});

// --- GET ALL AVAILABLE PRODUCTS ROUTE ---
app.get('/api/products', authenticateToken, (req, res) => {
    // This query grabs the product details, its category name, and its first image
    const query = `
        SELECT p.ProductID, p.ProductName, p.SellingPrice, p.Status, 
               c.CategoryName, 
               (SELECT ImagePath FROM ProductImages WHERE ProductID = p.ProductID LIMIT 1) as ImagePath
        FROM Products p
        JOIN Categories c ON p.CategoryID = c.CategoryID
        WHERE p.Status = 'Available'
        ORDER BY p.CreatedAt DESC
    `;
    
    db.query(query, (err, results) => {
        if (err) {
            console.error('Database error fetching products:', err);
            return res.status(500).json({ error: 'Failed to fetch products' });
        }
        res.json(results);
    });
});

// --- GET SINGLE PRODUCT DETAILS ROUTE ---
app.get('/api/products/:id', authenticateToken, (req, res) => {
    const productId = req.params.id;
    
    // Fetch product details, category name, and seller name
    const productQuery = `
        SELECT p.*, c.CategoryName, u.Name AS SellerName 
        FROM Products p
        JOIN Categories c ON p.CategoryID = c.CategoryID
        JOIN Users u ON p.SellerID = u.UserID
        WHERE p.ProductID = ?
    `;
    
    db.query(productQuery, [productId], (err, productResults) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (productResults.length === 0) return res.status(404).json({ error: 'Product not found' });
        
        const product = productResults[0];
        
        // Fetch associated images
        db.query('SELECT ImagePath FROM ProductImages WHERE ProductID = ?', [productId], (err, imageResults) => {
            if (err) return res.status(500).json({ error: 'Database error fetching images' });
            
            product.images = imageResults.map(img => img.ImagePath);
            res.json(product);
        });
    });
});

// Add this to your --- PAGE ROUTES --- section at the bottom:
app.get('/product', (req, res) => res.sendFile(path.join(__dirname, 'public', 'product.html')));

// --- PAGE ROUTES ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/sell', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sell.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});