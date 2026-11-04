const express = require('express');
const path = require('path');
const cors = require('cors');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- DATABASE CONNECTION ---
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

// --- MULTER CONFIGURATION (Ankit's robust setup) ---
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + path.extname(file.originalname);
    cb(null, uniqueSuffix);
  }
});
const upload = multer({ storage: storage });


// ==========================================
// 1. AUTHENTICATION & USER ROUTES
// ==========================================

app.post('/api/signup', async (req, res) => {
    const { name, email, password } = req.body;
    const domain = email.substring(email.lastIndexOf('@')).toLowerCase().trim();

    db.query('SELECT InstitutionID FROM Institutions WHERE EmailDomain = ?', [domain], async (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (results.length === 0) return res.status(400).json({ error: 'Invalid Institutional Email.' });

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

// Profile Details (Himanshu's Implementation)
app.get('/api/auth/me', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.query('SELECT Name, Email, ProfilePicture, BackgroundImage FROM Users WHERE UserID = ?', [userId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({
            user: {
                name: results[0].Name,
                email: results[0].Email,
                ProfilePicture: results[0].ProfilePicture,
                BackgroundImage: results[0].BackgroundImage 
            }
        });
    });
});

// Profile Stats (Himanshu's Implementation)
app.get('/api/profile/stats', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const statsQuery = `
        SELECT 
            (SELECT COUNT(*) FROM Products WHERE SellerID = ? AND Status = 'Available') AS activeListings,
            (SELECT COUNT(*) FROM InterestRequests WHERE BuyerID = ?) AS requestsSent,
            (SELECT COUNT(*) FROM InterestRequests WHERE SellerID = ?) AS requestsReceived,
            (SELECT COUNT(*) FROM Products WHERE SellerID = ? AND Status = 'Sold') AS tradesCompleted
    `;
    db.query(statsQuery, [userId, userId, userId, userId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch statistics' });
        res.json(results[0]);
    });
});

// Profile Images Upload (Himanshu's Implementation)
app.post('/api/profile/images', authenticateToken, upload.fields([
    { name: 'profilePic', maxCount: 1 },
    { name: 'bgImage', maxCount: 1 }
]), (req, res) => {
    const userId = req.user.userId;
    let updates = [], values = [];

    if (req.files['profilePic']) {
        updates.push('ProfilePicture = ?');
        values.push(`/uploads/${req.files['profilePic'][0].filename}`);
    }
    if (req.files['bgImage']) {
        updates.push('BackgroundImage = ?');
        values.push(`/uploads/${req.files['bgImage'][0].filename}`);
    }

    if (updates.length === 0) return res.status(400).json({ error: 'No files selected.' });

    values.push(userId);
    db.query(`UPDATE Users SET ${updates.join(', ')} WHERE UserID = ?`, values, (err) => {
        if (err) return res.status(500).json({ error: 'Database update failed.' });
        res.json({ success: true, message: 'Profile images updated successfully!' });
    });
});


// ==========================================
// 2. PRODUCT ROUTES
// ==========================================

// Create Product (Ankit's Multi-Image Implementation)
app.post('/api/products', authenticateToken, (req, res, next) => {
    upload.array('productImage')(req, res, (err) => {
        if (err) return res.status(500).json({ error: 'Failed to upload product images.' });
        next();
    });
}, (req, res) => {
    const { categoryId, productName, description, purchaseDateApprox, usageDuration, sellingPrice, conditionStatus, defectDetails } = req.body;
    
    if (typeof sellingPrice !== 'string' || !/^[1-9]\d*$/.test(sellingPrice) || Number(sellingPrice) > 99999999) {
        return res.status(400).json({ error: 'Selling price must be a positive whole number.' });
    }

    const sellerId = req.user.userId; 
    const imagePaths = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

    if (imagePaths.length === 0) return res.status(400).json({ error: 'Please upload at least one image.' });

    const insertProductQuery = `
        INSERT INTO Products (SellerID, CategoryID, ProductName, Description, PurchaseDateApprox, UsageDuration, SellingPrice, ConditionStatus, DefectDetails) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.query(insertProductQuery, [sellerId, categoryId, productName, description, purchaseDateApprox, usageDuration, Number(sellingPrice), conditionStatus, defectDetails], (err, productResult) => {
        if (err) return res.status(500).json({ error: 'Failed to save product details.' });

        const newProductId = productResult.insertId;
        const insertImageQuery = `INSERT INTO ProductImages (ProductID, ImagePath, DisplayOrder) VALUES ?`;
        const imageValues = imagePaths.map((path, index) => [newProductId, path, index + 1]);
        
        db.query(insertImageQuery, [imageValues], (err) => {
            if (err) return res.status(500).json({ error: 'Product saved, but image linking failed.' });
            res.json({ success: true, message: 'Item listed successfully!' });
        });
    });
});

// Get All Products (Ankit's Ordered Image Logic)
app.get('/api/products', authenticateToken, (req, res) => {
    const query = `
        SELECT p.ProductID, p.ProductName, p.SellingPrice, p.Status, c.CategoryName, 
               (SELECT ImagePath FROM ProductImages WHERE ProductID = p.ProductID ORDER BY DisplayOrder ASC LIMIT 1) as ImagePath
        FROM Products p
        JOIN Categories c ON p.CategoryID = c.CategoryID
        WHERE p.Status = 'Available'
        ORDER BY p.CreatedAt DESC
    `;
    db.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch products' });
        res.json(results);
    });
});

// Get My Products (Mukesh's Implementation)
app.get('/api/my-products', authenticateToken, (req, res) => {
    const sellerId = req.user.userId;
    const query = `
        SELECT p.ProductID, p.ProductName, p.SellingPrice, p.Status, p.CreatedAt, c.CategoryName, 
               (SELECT ImagePath FROM ProductImages WHERE ProductID = p.ProductID LIMIT 1) as ImagePath
        FROM Products p
        JOIN Categories c ON p.CategoryID = c.CategoryID
        WHERE p.SellerID = ?
        ORDER BY p.CreatedAt DESC
    `;
    db.query(query, [sellerId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch your listings' });
        res.json(results);
    });
});

// Get Single Product (Mukesh's isOwner + Ankit's Ordered Images)
app.get('/api/products/:id', authenticateToken, (req, res) => {
    const productId = req.params.id;
    const currentUserId = req.user.userId; 
    
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
        const isOwner = (product.SellerID === currentUserId); 
        
        db.query('SELECT ImagePath FROM ProductImages WHERE ProductID = ? ORDER BY DisplayOrder ASC', [productId], (err, imageResults) => {
            if (err) return res.status(500).json({ error: 'Database error fetching images' });
            product.images = imageResults.map(img => img.ImagePath);
            product.isOwner = isOwner; 
            res.json(product);
        });
    });
});

// Edit Product (Mukesh's Implementation)
app.put('/api/products/:id', authenticateToken, (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;
    const { productName, categoryId, sellingPrice, conditionStatus, usageDuration, purchaseDateApprox, description, defectDetails } = req.body;

    db.query('SELECT SellerID FROM Products WHERE ProductID = ?', [productId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Product not found.' });
        if (results[0].SellerID !== userId) return res.status(403).json({ error: 'Unauthorized.' });

        const updateQuery = `UPDATE Products SET ProductName = ?, CategoryID = ?, SellingPrice = ?, ConditionStatus = ?, UsageDuration = ?, PurchaseDateApprox = ?, Description = ?, DefectDetails = ? WHERE ProductID = ?`;
        db.query(updateQuery, [productName, categoryId, sellingPrice, conditionStatus, usageDuration, purchaseDateApprox, description, defectDetails, productId], (err) => {
            if (err) return res.status(500).json({ error: 'Product update failed.' });
            res.json({ success: true, message: 'Product successfully updated!' });
        });
    });
});

// Delete Product (Mukesh's Implementation)
app.delete('/api/products/:id', authenticateToken, (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;

    db.query('SELECT SellerID FROM Products WHERE ProductID = ?', [productId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Product not found.' });
        if (results[0].SellerID !== userId) return res.status(403).json({ error: 'Unauthorized.' });

        db.query('DELETE FROM ProductImages WHERE ProductID = ?', [productId], (err) => {
            db.query('DELETE FROM InterestRequests WHERE ProductID = ?', [productId], (err) => {
                db.query('DELETE FROM Products WHERE ProductID = ?', [productId], (err) => {
                    if (err) return res.status(500).json({ error: 'Product delete failed.' });
                    res.json({ success: true, message: 'Product successfully deleted!' });
                });
            });
        });
    });
});


// ==========================================
// 3. INTEREST & PURCHASING ROUTES
// ==========================================

// Express Interest (Your Baseline Code)
app.post('/api/interest', authenticateToken, (req, res) => {
    const { productId, message } = req.body;
    const buyerId = req.user.userId;

    db.query('SELECT SellerID FROM Products WHERE ProductID = ?', [productId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Product not found.' });
        const sellerId = results[0].SellerID;

        if (buyerId === sellerId) return res.status(400).json({ error: "You cannot request your own item." });

        const insertQuery = `INSERT INTO InterestRequests (ProductID, BuyerID, SellerID, Message) VALUES (?, ?, ?, ?)`;
        db.query(insertQuery, [productId, buyerId, sellerId, message || "I am interested in buying this."], (err) => {
            if (err) return res.status(500).json({ error: 'Failed to send request.' });
            res.json({ success: true, message: 'Request sent to the seller!' });
        });
    });
});

// Get My Purchases (Your Baseline Code)
app.get('/api/purchases', authenticateToken, (req, res) => {
    const buyerId = req.user.userId;
    const query = `
        SELECT ir.RequestID, ir.RequestStatus, ir.CreatedAt, 
               p.ProductID, p.ProductName, p.SellingPrice, u.Name AS SellerName,
               (SELECT ImagePath FROM ProductImages WHERE ProductID = p.ProductID ORDER BY DisplayOrder ASC LIMIT 1) as ImagePath
        FROM InterestRequests ir
        JOIN Products p ON ir.ProductID = p.ProductID
        JOIN Users u ON p.SellerID = u.UserID
        WHERE ir.BuyerID = ?
        ORDER BY ir.CreatedAt DESC
    `;
    db.query(query, [buyerId], (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to load purchases.' });
        res.json(results);
    });
});

// View Interest Requests for Seller (Mukesh's Implementation)
app.get('/api/products/:id/requests', authenticateToken, (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;

    db.query('SELECT SellerID FROM Products WHERE ProductID = ?', [productId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Product not found.' });
        if (results[0].SellerID !== userId) return res.status(403).json({ error: 'Unauthorized.' });

        const query = `
            SELECT ir.RequestID, ir.Message, ir.RequestStatus, ir.CreatedAt,
            u.Name AS BuyerName, u.Email AS BuyerEmail, u.UserID AS BuyerID
            FROM InterestRequests ir
            JOIN Users u ON ir.BuyerID = u.UserID
            WHERE ir.ProductID = ?
            ORDER BY ir.CreatedAt DESC
        `;
        db.query(query, [productId], (err, reqResults) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch requests.' });
            res.json(reqResults);
        });
    });
});

// Accept/Decline Request (Mukesh's Implementation)
app.put('/api/interest/:requestId', authenticateToken, (req, res) => {
    const requestId = req.params.requestId;
    const { status } = req.body; 
    const userId = req.user.userId;

    const query = `
        SELECT ir.*, p.SellerID FROM InterestRequests ir
        JOIN Products p ON ir.ProductID = p.ProductID
        WHERE ir.RequestID = ?
    `;
    db.query(query, [requestId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Request not found.' });
        if (results[0].SellerID !== userId) return res.status(403).json({ error: 'Unauthorized.' });

        db.query('UPDATE InterestRequests SET RequestStatus = ? WHERE RequestID = ?', [status, requestId], (err) => {
            if (err) return res.status(500).json({ error: 'Status update failed.' });
            res.json({ success: true, message: `Request ${status} successfully!` });
        });
    });
});


// ==========================================
// 4. CHAT & MESSAGING ROUTES (Fixed & Unified)
// ==========================================

app.post('/api/conversations', authenticateToken, (req, res) => {
    const { productId, buyerId, sellerId } = req.body;
    const currentUserId = req.user.userId;

    // Auto-detect buyer based on who is clicking
    const targetBuyerId = buyerId || currentUserId;
    
    // Find actual seller of the product directly from the database to ensure accuracy
    db.query('SELECT SellerID FROM Products WHERE ProductID = ?', [productId], (err, results) => {
        if (err || results.length === 0) return res.status(404).json({ error: 'Product not found.' });
        
        const targetSellerId = results[0].SellerID;

        if (targetBuyerId === targetSellerId) return res.status(400).json({ error: 'Cannot chat with yourself.' });

        // 1. Check if chat already exists
        const checkQuery = `SELECT ConversationID FROM Conversations WHERE ProductID = ? AND BuyerID = ? AND SellerID = ?`;
        db.query(checkQuery, [productId, targetBuyerId, targetSellerId], (err, convResults) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            
            // If it exists, seamlessly return the old ID to reopen the chat history!
            if (convResults.length > 0) return res.json({ conversationId: convResults[0].ConversationID });

            // 2. If no chat exists, create a brand new one
            const insertQuery = `INSERT INTO Conversations (ProductID, BuyerID, SellerID) VALUES (?, ?, ?)`;
            db.query(insertQuery, [productId, targetBuyerId, targetSellerId], (err, insertResult) => {
                if (err) return res.status(500).json({ error: 'Failed to create conversation.' });
                res.json({ conversationId: insertResult.insertId });
            });
        });
    });
});

app.get('/api/conversations/:id/messages', authenticateToken, (req, res) => {
    const conversationId = req.params.id;
    const userId = req.user.userId;

    const verifyQuery = `SELECT * FROM Conversations WHERE ConversationID = ? AND (BuyerID = ? OR SellerID = ?)`;
    db.query(verifyQuery, [conversationId, userId, userId], (err, results) => {
        if (err || results.length === 0) return res.status(403).json({ error: 'Unauthorized access.' });

        const msgQuery = `
            SELECT m.MessageID, m.MessageText, m.SentAt, m.SenderID, u.Name AS SenderName
            FROM Messages m
            JOIN Users u ON m.SenderID = u.UserID
            WHERE m.ConversationID = ?
            ORDER BY m.SentAt ASC
        `;
        db.query(msgQuery, [conversationId], (err, msgResults) => {
            if (err) return res.status(500).json({ error: 'Failed to fetch messages.' });
            res.json(msgResults);
        });
    });
});

app.post('/api/conversations/:id/messages', authenticateToken, (req, res) => {
    const conversationId = req.params.id;
    const senderId = req.user.userId;
    
    // Safely accept message text from both the new chat.html and the old framework
    const messageText = req.body.text || req.body.messageText;

    if (!messageText || messageText.trim() === '') return res.status(400).json({ error: 'Message cannot be empty.' });

    const verifyQuery = `SELECT * FROM Conversations WHERE ConversationID = ? AND (BuyerID = ? OR SellerID = ?)`;
    db.query(verifyQuery, [conversationId, senderId, senderId], (err, results) => {
        if (err || results.length === 0) return res.status(403).json({ error: 'Unauthorized.' });

        const insertMsg = `INSERT INTO Messages (ConversationID, SenderID, MessageText) VALUES (?, ?, ?)`;
        db.query(insertMsg, [conversationId, senderId, messageText], (err) => {
            if (err) return res.status(500).json({ error: 'Failed to send message.' });
            res.json({ success: true });
        });
    });
});


// ==========================================
// 5. PAGE ROUTING
// ==========================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/sell', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sell.html')));
app.get('/product', (req, res) => res.sendFile(path.join(__dirname, 'public', 'product.html')));
app.get('/purchases', (req, res) => res.sendFile(path.join(__dirname, 'public', 'purchases.html')));
app.get('/my-listings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-listings.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});