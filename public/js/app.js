document.addEventListener("DOMContentLoaded", async () => {
    const token = localStorage.getItem('token');

    if (!token) {
        window.location.href = '/';
        return;
    }

    // 1. Authenticate user and update profile header
    try {
        const response = await fetch('/api/auth/me', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();
        if (!response.ok) {
            localStorage.removeItem('token');
            window.location.href = '/';
            return;
        }

        const userProfileDiv = document.querySelector('.user-profile');
        if (userProfileDiv) {
            userProfileDiv.innerHTML = `
                <strong>${data.user.name}</strong><br>
                <span style="font-size: 12px; color: #666;">${data.user.email}</span>
            `;
        }

        // 2. Fetch and display products on the dashboard
        loadProducts(token);

    } catch (err) {
        console.error('Error:', err);
    }
});

// Function to fetch products from the database and inject them into the HTML
async function loadProducts(token) {
    try {
        const response = await fetch('/api/products', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const products = await response.json();
        const container = document.getElementById('product-container');
        
        // Clear out the hardcoded placeholders
        container.innerHTML = '';

        if (products.length === 0) {
            container.innerHTML = '<p style="color: #666; margin-top: 20px;">No items are currently listed for sale.</p>';
            return;
        }

        // Loop through database results and create a card for each
        products.forEach(product => {
            const imageStyle = product.ImagePath 
                ? `background: url('${product.ImagePath}') center/cover no-repeat;` 
                : `background: #eee;`;

            // ADDED onclick routing right here:
            const card = `
                <div class="product-card" onclick="window.location.href='/product?id=${product.ProductID}'" style="cursor: pointer; border: 1px solid #ddd; padding: 10px; border-radius: 8px; transition: transform 0.2s;">
                    <div style="height: 150px; border-radius: 8px; margin-bottom: 10px; ${imageStyle}"></div>
                    <span style="font-size: 12px; color: #888;">${product.CategoryName}</span>
                    <h3 style="margin: 5px 0;">${product.ProductName}</h3>
                    <div class="price" style="font-weight: bold; color: #0066cc;">₹ ${product.SellingPrice}</div>
                    <span class="badge-available" style="font-size: 12px; color: green;">● ${product.Status}</span>
                </div>
            `;
            container.innerHTML += card;
        });

    } catch (err) {
        console.error('Failed to load products:', err);
    }
}