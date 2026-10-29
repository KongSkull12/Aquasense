# API Folder Structure Guide

## 📁 New API Organization

Your backend now uses a versioned API structure for scalability and maintainability:

```
src/api/
├── index.ts                  # Main API router (routes all versions)
└── v1/
    ├── routes/
    │   ├── index.ts         # V1 routes aggregator
    │   ├── health.ts        # Health check routes
    │   └── user.ts          # Example: User routes (create this)
    └── controllers/
        ├── healthController.ts
        └── userController.ts (create this)
```

## 🚀 How to Add a New API Endpoint

### Step 1: Create Controller
**File:** `src/api/v1/controllers/userController.ts`

```typescript
import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../../../utils/response';
import { userService } from '../../../services/userService';

export const getAllUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await userService.getAllUsers();
    sendSuccess(res, 200, 'Users retrieved', users);
  } catch (error) {
    sendError(res, 500, 'Failed to retrieve users');
  }
};
```

### Step 2: Create Routes
**File:** `src/api/v1/routes/user.ts`

```typescript
import { Router } from 'express';
import { getAllUsers } from '../controllers/userController';

const router = Router();

router.get('/users', getAllUsers);  // GET /api/v1/users

export default router;
```

### Step 3: Register Routes
**File:** `src/api/v1/routes/index.ts` (Update)

```typescript
import { Router } from 'express';
import healthRoutes from './health';
import userRoutes from './user';      // Add this

const router = Router();

router.use(healthRoutes);
router.use(userRoutes);               // Add this

export default router;
```

### Step 4: Create Service (Optional)
**File:** `src/services/userService.ts`

```typescript
import { logger } from '../utils/logger';

export class UserService {
  async getAllUsers() {
    logger.info('Fetching all users');
    // Your database logic here
    return [];
  }
}

export const userService = new UserService();
```

## 📋 Available Endpoints After Setup

```
GET    /api/v1/health              - API health status
GET    /api/v1/users               - Get all users
POST   /api/v1/users               - Create new user
GET    /api/v1/users/:id           - Get user by ID
PUT    /api/v1/users/:id           - Update user
DELETE /api/v1/users/:id           - Delete user
```

## 🔄 API Response Format

**Success Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Users retrieved",
  "data": [
    { "id": "1", "name": "John" }
  ]
}
```

**Error Response:**
```json
{
  "success": false,
  "statusCode": 500,
  "message": "Failed to retrieve users",
  "error": "Database connection failed"
}
```

## 🛠️ Helper Utilities

### Response Helpers
```typescript
import { sendSuccess, sendError } from '../../../utils/response';

// Send success response
sendSuccess(res, 200, 'Success message', data);

// Send error response
sendError(res, 400, 'Error message', errorDetails);
```

### Custom Errors
```typescript
import { 
  ApiError, 
  ValidationError, 
  NotFoundError,
  UnauthorizedError 
} from '../../../utils/errors';

// Usage in services
if (!user) {
  throw new NotFoundError('User not found');
}

if (!request.email) {
  throw new ValidationError('Email is required');
}
```

### Logger
```typescript
import { logger } from '../../../utils/logger';

logger.debug('Debug message', { key: 'value' });
logger.info('User created', { userId: '123' });
logger.warn('Deprecated endpoint used');
logger.error('Database error', error);
```

## 📝 Example: Complete User Feature

### 1. Controller (`src/api/v1/controllers/userController.ts`)
```typescript
import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../../../utils/response';
import { userService } from '../../../services/userService';
import { ValidationError } from '../../../utils/errors';

export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email } = req.body;

    if (!name || !email) {
      throw new ValidationError('Name and email required');
    }

    const user = await userService.createUser({ name, email });
    sendSuccess(res, 201, 'User created', user);
  } catch (error) {
    if (error instanceof ValidationError) {
      sendError(res, error.statusCode, error.message);
    } else {
      sendError(res, 500, 'Failed to create user');
    }
  }
};
```

### 2. Routes (`src/api/v1/routes/user.ts`)
```typescript
import { Router } from 'express';
import { createUser, getAllUsers } from '../controllers/userController';

const router = Router();

router.post('/users', createUser);
router.get('/users', getAllUsers);

export default router;
```

### 3. Service (`src/services/userService.ts`)
```typescript
import { logger } from '../utils/logger';

export class UserService {
  async createUser(data: { name: string; email: string }) {
    logger.debug('Creating user', data);
    
    // Database logic here
    const user = { id: '1', ...data };
    
    logger.info('User created', { userId: user.id });
    return user;
  }

  async getAllUsers() {
    logger.info('Fetching all users');
    return [];
  }
}

export const userService = new UserService();
```

## 🔮 Future API Versions

When you need to create API v2:

```
src/api/
├── v1/
│   ├── routes/
│   └── controllers/
└── v2/                  # New version
    ├── routes/
    └── controllers/
```

Update `src/api/index.ts`:
```typescript
import { Router } from 'express';
import v1Routes from './v1/routes';
import v2Routes from './v2/routes';

const router = Router();

router.use('/v1', v1Routes);
router.use('/v2', v2Routes);   // Add new version

export default router;
```

## ✅ Build and Test

```bash
# Build TypeScript
npm run build

# Start development server
npm run dev

# Test endpoints
curl http://localhost:5000/api/v1/health
```

## 📚 Template Files

Use these as reference when creating new endpoints:
- `EXAMPLE_userController.ts` - Complete controller example
- `EXAMPLE_user.ts` - Complete routes example

---

**Status**: ✅ API structure ready for development!
