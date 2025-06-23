// MongoDB initialization script
// This runs when MongoDB container is first created

// Switch to the ai-cost-optimizer database
db = db.getSiblingDB('ai-cost-optimizer');

// Create application user
db.createUser({
  user: 'appuser',
  pwd: 'apppass123',
  roles: [
    {
      role: 'readWrite',
      db: 'ai-cost-optimizer'
    }
  ]
});

// Create initial collections with validation
db.createCollection('users', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['email', 'password', 'name'],
      properties: {
        email: {
          bsonType: 'string',
          pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'
        },
        password: {
          bsonType: 'string',
          minLength: 8
        },
        name: {
          bsonType: 'string',
          minLength: 2
        }
      }
    }
  }
});

db.createCollection('usages');
db.createCollection('optimizations');
db.createCollection('alerts');

print('MongoDB initialized successfully');