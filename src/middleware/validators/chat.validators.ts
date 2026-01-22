import { param, body } from 'express-validator';

/**
 * Common validation chains for chat routes
 * These are the actual patterns repeated across multiple routes
 */
export const chatValidators = {
  /**
   * Validates MongoDB ObjectId in URL params
   * Used in: renameConversation, archiveConversation, pinConversation, etc.
   */
  conversationId: param('id').isMongoId().withMessage('Invalid conversation ID'),
  
  /**
   * Validates MongoDB ObjectId for conversationId param
   */
  conversationIdParam: param('conversationId').isMongoId().withMessage('Invalid conversationId'),
  
  /**
   * Validates MongoDB ObjectId for taskId param
   */
  taskIdParam: param('taskId').isMongoId().withMessage('Invalid taskId'),
  
  /**
   * Validates MongoDB ObjectId for chatId param
   */
  chatIdParam: param('chatId').isMongoId().withMessage('Invalid chatId'),
  
  /**
   * Validates boolean field for archive status
   */
  archivedBody: body('archived').isBoolean().withMessage('archived must be a boolean'),
  
  /**
   * Validates boolean field for pin status
   */
  pinnedBody: body('pinned').isBoolean().withMessage('pinned must be a boolean'),
  
  /**
   * Validates title for conversation rename
   */
  titleBody: body('title')
    .notEmpty()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
    
  /**
   * Validates conversationId in request body (optional)
   */
  conversationIdBody: body('conversationId')
    .optional()
    .isMongoId()
    .withMessage('Invalid conversationId'),
    
  /**
   * Validates message string in request body
   */
  messageBody: body('message')
    .notEmpty()
    .isString()
    .withMessage('Message is required'),
    
  /**
   * Validates feedback string in request body
   */
  feedbackBody: body('feedback')
    .notEmpty()
    .isString()
    .withMessage('Feedback is required'),
};

/**
 * Creates a validation chain for governed agent routes
 * Most governed agent routes follow similar patterns
 */
export const governedValidators = {
  initiateChat: [
    chatValidators.messageBody,
    chatValidators.conversationIdBody
  ],
  
  submitAnswers: [
    chatValidators.taskIdParam,
    body('answers').isObject().withMessage('Answers must be an object')
  ],
  
  requestChanges: [
    chatValidators.taskIdParam,
    chatValidators.feedbackBody
  ],
  
  navigateMode: [
    chatValidators.taskIdParam,
    body('mode').notEmpty().isString().withMessage('Mode is required')
  ],
  
  modifyPlan: [
    chatValidators.chatIdParam,
    body('taskId').isMongoId().withMessage('Invalid taskId'),
    body('modifications').isObject().withMessage('Modifications object is required')
  ],
  
  questionPlan: [
    chatValidators.chatIdParam,
    body('taskId').isMongoId().withMessage('Invalid taskId'),
    body('question').notEmpty().isString().withMessage('Question is required')
  ],
  
  redeployTask: [
    chatValidators.chatIdParam,
    chatValidators.taskIdParam,
    body('changeRequest').notEmpty().isString().withMessage('Change request is required')
  ]
};
