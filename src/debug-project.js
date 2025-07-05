const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

// Connect to MongoDB
const MONGODB_URI = "mongodb+srv://abdul:851WzGn8mf8cW8Y4@cluster0.xtxpyil.mongodb.net/ai-cost-tracker";

async function debugProjectCreation() {
    try {
        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Test JWT token decoding
        const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4NWQxMzE4NzgwYmM0ZTI5OWJlYWI1MCIsImVtYWlsIjoiYWJkdWxAaHlwb3RoZXNpemUudGVjaCIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzUxNjk4Njk4LCJleHAiOjE3NTIzMDM0OTh9.HnKrws8h9P1ssxmvlQkHEJSmMSXLn4R4uC-L1ljVyHc";
        
        console.log('🔍 Decoding JWT token...');
        const decoded = jwt.decode(token);
        console.log('Token payload:', decoded);
        
        // Check if token is expired
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp < now) {
            console.log('❌ Token is expired!');
            console.log('Token expired at:', new Date(decoded.exp * 1000));
            console.log('Current time:', new Date());
            return;
        }
        console.log('✅ Token is valid');

        // Check if user exists
        const User = mongoose.model('User', new mongoose.Schema({
            email: String,
            name: String,
            role: String
        }));

        console.log('👤 Looking for user...');
        const user = await User.findById(decoded.id);
        if (!user) {
            console.log('❌ User not found!');
            return;
        }
        console.log('✅ User found:', {
            id: user._id,
            email: user.email,
            name: user.name
        });

        // Test project creation
        const Project = mongoose.model('Project', new mongoose.Schema({
            name: String,
            description: String,
            ownerId: mongoose.Schema.Types.ObjectId,
            budget: {
                amount: Number,
                period: String,
                currency: String,
                alerts: Array
            },
            settings: Object,
            tags: [String],
            isActive: { type: Boolean, default: true },
            spending: {
                current: { type: Number, default: 0 },
                lastUpdated: { type: Date, default: Date.now },
                history: Array
            },
            members: Array
        }, { timestamps: true }));

        console.log('📝 Creating test project...');
        const projectData = {
            name: "Debug Test Project",
            description: "Test project for debugging",
            ownerId: decoded.id,
            budget: {
                amount: 1000,
                period: "monthly",
                currency: "USD",
                alerts: [
                    { threshold: 50, type: "both", recipients: [] },
                    { threshold: 80, type: "both", recipients: [] },
                    { threshold: 100, type: "both", recipients: [] }
                ]
            },
            settings: {
                enablePromptLibrary: true,
                enableCostAllocation: true
            },
            tags: ["AI", "Debug"],
            members: []
        };

        const project = new Project(projectData);
        const savedProject = await project.save();
        
        console.log('✅ Project created successfully!');
        console.log('Project ID:', savedProject._id);
        console.log('Project Name:', savedProject.name);

        // Clean up - delete the test project
        await Project.findByIdAndDelete(savedProject._id);
        console.log('🧹 Test project cleaned up');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Stack:', error.stack);
    } finally {
        await mongoose.connection.close();
        console.log('🔌 Disconnected from MongoDB');
    }
}

debugProjectCreation(); 