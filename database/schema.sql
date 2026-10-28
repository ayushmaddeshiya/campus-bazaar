CREATE DATABASE IF NOT EXISTS campus_bazaar;
USE campus_bazaar;

CREATE TABLE Institutions (
    InstitutionID INT AUTO_INCREMENT PRIMARY KEY,
    InstitutionName VARCHAR(100) NOT NULL,
    EmailDomain VARCHAR(50) NOT NULL UNIQUE,
    IsActive BOOLEAN DEFAULT TRUE
);

CREATE TABLE Users (
    UserID INT AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(100) NOT NULL,
    Email VARCHAR(100) NOT NULL UNIQUE,
    PasswordHash VARCHAR(255) NOT NULL,
    InstitutionID INT,
    EmailVerified BOOLEAN DEFAULT FALSE,
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (InstitutionID) REFERENCES Institutions(InstitutionID)
);

CREATE TABLE Categories (
    CategoryID INT AUTO_INCREMENT PRIMARY KEY,
    CategoryName VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE Products (
    ProductID INT AUTO_INCREMENT PRIMARY KEY,
    SellerID INT NOT NULL,
    CategoryID INT NOT NULL,
    ProductName VARCHAR(150) NOT NULL,
    Description TEXT,
    PurchaseDateApprox VARCHAR(50),
    UsageDuration VARCHAR(50),
    SellingPrice DECIMAL(10,2) NOT NULL,
    ConditionStatus ENUM('New', 'Lightly Used', 'Good', 'Fair') NOT NULL,
    DefectDetails TEXT,
    Status ENUM('Available', 'Pending', 'Sold', 'Removed') DEFAULT 'Available',
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (SellerID) REFERENCES Users(UserID),
    FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID)
);

CREATE TABLE ProductImages (
    ImageID INT AUTO_INCREMENT PRIMARY KEY,
    ProductID INT NOT NULL,
    ImagePath VARCHAR(255) NOT NULL,
    DisplayOrder INT DEFAULT 1,
    FOREIGN KEY (ProductID) REFERENCES Products(ProductID) ON DELETE CASCADE
);

CREATE TABLE InterestRequests (
    RequestID INT AUTO_INCREMENT PRIMARY KEY,
    ProductID INT NOT NULL,
    BuyerID INT NOT NULL,
    SellerID INT NOT NULL,
    Message TEXT,
    RequestStatus ENUM('Pending', 'Accepted', 'Declined') DEFAULT 'Pending',
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ProductID) REFERENCES Products(ProductID),
    FOREIGN KEY (BuyerID) REFERENCES Users(UserID),
    FOREIGN KEY (SellerID) REFERENCES Users(UserID)
);

CREATE TABLE Conversations (
    ConversationID INT AUTO_INCREMENT PRIMARY KEY,
    ProductID INT NOT NULL,
    BuyerID INT NOT NULL,
    SellerID INT NOT NULL,
    CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(ProductID, BuyerID, SellerID),
    FOREIGN KEY (ProductID) REFERENCES Products(ProductID),
    FOREIGN KEY (BuyerID) REFERENCES Users(UserID),
    FOREIGN KEY (SellerID) REFERENCES Users(UserID)
);

CREATE TABLE Messages (
    MessageID INT AUTO_INCREMENT PRIMARY KEY,
    ConversationID INT NOT NULL,
    SenderID INT NOT NULL,
    MessageText TEXT NOT NULL,
    SentAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ConversationID) REFERENCES Conversations(ConversationID),
    FOREIGN KEY (SenderID) REFERENCES Users(UserID)
);

-- Insert Sample Data
INSERT INTO Institutions (InstitutionName, EmailDomain) VALUES ('Delhi University', '@ce.du.ac.in');
INSERT INTO Categories (CategoryName) VALUES ('Books & Notes'), ('Electronics'), ('Furniture'), ('Clothing'), ('Sports & Fitness');