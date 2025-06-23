import { UserRole } from './models';

declare global {
    namespace Express {
        interface UserPayload {
            id: string;
            email: string;
            role: UserRole;
        }
        interface Request {
            user?: UserPayload;
            userId?: string;
        }
    }
}