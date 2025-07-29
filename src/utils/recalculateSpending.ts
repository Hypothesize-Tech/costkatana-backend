import { ProjectService } from '../services/project.service';
import { connectDatabase } from '../config/database';
import { logger } from './logger';

async function recalculateAllProjectSpending() {
    try {
        // Connect to MongoDB
        await connectDatabase();
        logger.info('Connected to MongoDB');

        // Recalculate spending for all projects
        await ProjectService.recalculateAllProjectSpending();

        logger.info('Successfully recalculated spending for all projects');
        process.exit(0);
    } catch (error) {
        logger.error('Error recalculating project spending:', error);
        process.exit(1);
    }
}

// Run the script
recalculateAllProjectSpending(); 