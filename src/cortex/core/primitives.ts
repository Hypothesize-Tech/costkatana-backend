/**
 * Cortex Core Primitives Vocabulary
 * Universal semantic building blocks for the Cortex meta-language
 */

import { PrimitiveVocabulary } from '../types';

/**
 * Core Primitives Vocabulary v1.0 with ID Mapping
 * These primitives form the foundational vocabulary for Cortex expressions
 * Each primitive has a unique ID for efficient encoding
 */

// Primitive ID mapping for ultra-efficient encoding
export const PrimitiveIds = {
  // Actions (1-1000)
  action_jump: 54,
  action_get: 1,
  action_fetch: 2,
  action_retrieve: 3,
  action_find: 4,
  action_search: 5,
  action_query: 6,
  action_lookup: 7,
  action_create: 8,
  action_generate: 9,
  action_produce: 10,
  action_compose: 11,
  action_write: 12,
  action_design: 13,
  action_build: 14,
  action_analyze: 15,
  action_evaluate: 16,
  action_assess: 17,
  action_examine: 18,
  action_inspect: 19,
  action_review: 20,
  action_audit: 21,
  action_transform: 22,
  action_convert: 23,
  action_translate: 24,
  action_adapt: 25,
  action_modify: 26,
  action_update: 27,
  action_enhance: 28,
  action_summarize: 29,
  action_extract: 30,
  action_abstract: 31,
  action_condense: 32,
  action_highlight: 33,
  action_outline: 34,
  action_compare: 35,
  action_contrast: 36,
  action_correlate: 37,
  action_match: 38,
  action_differentiate: 39,
  action_relate: 40,
  action_calculate: 41,
  action_compute: 42,
  action_measure: 43,
  action_estimate: 44,
  action_predict: 45,
  action_forecast: 46,
  action_project: 47,
  action_organize: 48,
  action_categorize: 49,
  action_classify: 50,
  action_group: 51,
  action_sort: 52,
  action_filter: 53,
  action_rank: 55,
  action_validate: 56,
  action_verify: 57,
  action_confirm: 58,
  action_check: 59,
  action_test: 60,
  action_prove: 61,
  action_explain: 62,
  action_describe: 63,
  action_narrate: 64,
  action_report: 65,
  action_present: 66,
  action_demonstrate: 67,
  
  // Concepts (1001-2000)
  concept_fox: 1123,
  concept_dog: 876,
  concept_document: 1001,
  concept_report: 1002,
  concept_article: 1003,
  concept_paper: 1004,
  concept_book: 1005,
  concept_email: 1006,
  concept_message: 1007,
  concept_post: 1008,
  concept_comment: 1009,
  concept_note: 1010,
  concept_data: 1011,
  concept_database: 1012,
  concept_table: 1013,
  concept_record: 1014,
  concept_field: 1015,
  concept_schema: 1016,
  concept_index: 1017,
  concept_query: 1018,
  concept_person: 1019,
  concept_user: 1020,
  concept_customer: 1021,
  concept_employee: 1022,
  concept_team: 1023,
  concept_organization: 1024,
  concept_company: 1025,
  concept_department: 1026,
  concept_time: 1027,
  concept_date: 1028,
  concept_duration: 1029,
  concept_period: 1030,
  concept_event: 1031,
  concept_meeting: 1032,
  concept_appointment: 1033,
  concept_deadline: 1034,
  concept_movie: 1035,
  concept_franchise: 1036,
  
  // Properties (2001-3000)
  prop_quick: 2001,
  prop_brown: 2002,
  prop_lazy: 2003,
  prop_name: 2004,
  prop_title: 2005,
  prop_id: 2006,
  prop_identifier: 2007,
  prop_label: 2008,
  prop_tag: 2009,
  prop_description: 2010,
  prop_summary: 2011,
  prop_abstract: 2012,
  prop_content: 2013,
  prop_body: 2014,
  prop_text: 2015,
  prop_status: 2016,
  prop_state: 2017,
  prop_phase: 2018,
  prop_stage: 2019,
  prop_condition: 2020,
  prop_mode: 2021,
  prop_quality: 2022,
  prop_accuracy: 2023,
  prop_precision: 2024,
  prop_reliability: 2025,
  prop_performance: 2026,
  prop_efficiency: 2027,
  prop_sentiment: 2028,
  prop_emotion: 2029,
  prop_mood: 2030,
  prop_tone: 2031,
  prop_attitude: 2032,
  prop_main_themes: 2033,
  prop_plot: 2034,
  prop_color: 2035,
  
  // Modifiers (3001-4000)
  mod_latest: 3001,
  mod_previous: 3002,
  mod_current: 3003,
  mod_next: 3004,
  mod_recent: 3005,
  mod_past: 3006,
  mod_future: 3007,
  mod_all: 3008,
  mod_any: 3009,
  mod_some: 3010,
  mod_none: 3011,
  mod_each: 3012,
  mod_every: 3013,
  mod_most: 3014,
  mod_few: 3015,
  mod_many: 3016,
  mod_and: 3017,
  mod_or: 3018,
  mod_not: 3019,
  mod_definite: 3020,
  mod_indefinite: 3021
};

// Reverse mapping for decoding
export const PrimitiveNames: Record<number, string> = {};
Object.entries(PrimitiveIds).forEach(([name, id]) => {
  PrimitiveNames[id] = name;
});

export const CorePrimitives: PrimitiveVocabulary = {
  // ============= Actions =============
  actions: {
    // Information Retrieval
    get: 'action_get',
    fetch: 'action_fetch',
    retrieve: 'action_retrieve',
    find: 'action_find',
    search: 'action_search',
    query: 'action_query',
    lookup: 'action_lookup',
    
    // Content Generation
    create: 'action_create',
    generate: 'action_generate',
    produce: 'action_produce',
    compose: 'action_compose',
    write: 'action_write',
    design: 'action_design',
    build: 'action_build',
    
    // Analysis and Processing
    analyze: 'action_analyze',
    evaluate: 'action_evaluate',
    assess: 'action_assess',
    examine: 'action_examine',
    inspect: 'action_inspect',
    review: 'action_review',
    audit: 'action_audit',
    
    // Transformation
    transform: 'action_transform',
    convert: 'action_convert',
    translate: 'action_translate',
    adapt: 'action_adapt',
    modify: 'action_modify',
    update: 'action_update',
    enhance: 'action_enhance',
    
    // Summarization and Extraction
    summarize: 'action_summarize',
    extract: 'action_extract',
    abstract: 'action_abstract',
    condense: 'action_condense',
    highlight: 'action_highlight',
    outline: 'action_outline',
    
    // Comparison and Correlation
    compare: 'action_compare',
    contrast: 'action_contrast',
    correlate: 'action_correlate',
    match: 'action_match',
    differentiate: 'action_differentiate',
    relate: 'action_relate',
    
    // Calculation and Computation
    calculate: 'action_calculate',
    compute: 'action_compute',
    measure: 'action_measure',
    estimate: 'action_estimate',
    predict: 'action_predict',
    forecast: 'action_forecast',
    project: 'action_project',
    
    // Organization
    organize: 'action_organize',
    categorize: 'action_categorize',
    classify: 'action_classify',
    group: 'action_group',
    sort: 'action_sort',
    filter: 'action_filter',
    rank: 'action_rank',
    
    // Validation
    validate: 'action_validate',
    verify: 'action_verify',
    confirm: 'action_confirm',
    check: 'action_check',
    test: 'action_test',
    prove: 'action_prove',
    
    // Communication
    explain: 'action_explain',
    describe: 'action_describe',
    narrate: 'action_narrate',
    report: 'action_report',
    present: 'action_present',
    demonstrate: 'action_demonstrate',
    
    // Decision Making
    decide: 'action_decide',
    choose: 'action_choose',
    select: 'action_select',
    recommend: 'action_recommend',
    suggest: 'action_suggest',
    advise: 'action_advise',
    
    // Planning
    plan: 'action_plan',
    schedule: 'action_schedule',
    coordinate: 'action_coordinate',
    orchestrate: 'action_orchestrate',
    strategize: 'action_strategize',
    
    // Execution
    execute: 'action_execute',
    perform: 'action_perform',
    implement: 'action_implement',
    deploy: 'action_deploy',
    activate: 'action_activate',
    trigger: 'action_trigger',
    
    // Monitoring
    monitor: 'action_monitor',
    track: 'action_track',
    observe: 'action_observe',
    watch: 'action_watch',
    supervise: 'action_supervise',
    
    // Optimization
    optimize: 'action_optimize',
    improve: 'action_improve',
    refine: 'action_refine',
    streamline: 'action_streamline',
    
    // Learning
    learn: 'action_learn',
    train: 'action_train',
    evolve: 'action_evolve',
    discover: 'action_discover'
  },
  
  // ============= Concepts =============
  concepts: {
    // Documents and Content
    document: 'concept_document',
    report: 'concept_report',
    article: 'concept_article',
    paper: 'concept_paper',
    book: 'concept_book',
    email: 'concept_email',
    message: 'concept_message',
    post: 'concept_post',
    comment: 'concept_comment',
    note: 'concept_note',
    
    // Data Structures
    data: 'concept_data',
    database: 'concept_database',
    table: 'concept_table',
    record: 'concept_record',
    field: 'concept_field',
    schema: 'concept_schema',
    index: 'concept_index',
    query: 'concept_query',
    
    // People and Organizations
    person: 'concept_person',
    user: 'concept_user',
    customer: 'concept_customer',
    employee: 'concept_employee',
    team: 'concept_team',
    organization: 'concept_organization',
    company: 'concept_company',
    department: 'concept_department',
    
    // Time and Events
    time: 'concept_time',
    date: 'concept_date',
    duration: 'concept_duration',
    period: 'concept_period',
    event: 'concept_event',
    meeting: 'concept_meeting',
    appointment: 'concept_appointment',
    deadline: 'concept_deadline',
    
    // Places and Locations
    location: 'concept_location',
    address: 'concept_address',
    city: 'concept_city',
    country: 'concept_country',
    region: 'concept_region',
    coordinate: 'concept_coordinate',
    
    // Systems and Processes
    system: 'concept_system',
    process: 'concept_process',
    workflow: 'concept_workflow',
    pipeline: 'concept_pipeline',
    service: 'concept_service',
    application: 'concept_application',
    platform: 'concept_platform',
    
    // Financial
    cost: 'concept_cost',
    price: 'concept_price',
    budget: 'concept_budget',
    expense: 'concept_expense',
    revenue: 'concept_revenue',
    profit: 'concept_profit',
    invoice: 'concept_invoice',
    transaction: 'concept_transaction',
    
    // Metrics and Measurements
    metric: 'concept_metric',
    measurement: 'concept_measurement',
    statistic: 'concept_statistic',
    indicator: 'concept_indicator',
    score: 'concept_score',
    rating: 'concept_rating',
    percentage: 'concept_percentage',
    
    // AI and ML Specific
    model: 'concept_model',
    algorithm: 'concept_algorithm',
    neural_network: 'concept_neural_network',
    training_data: 'concept_training_data',
    prediction: 'concept_prediction',
    classification: 'concept_classification',
    token: 'concept_token',
    embedding: 'concept_embedding',
    
    // Media
    image: 'concept_image',
    video: 'concept_video',
    audio: 'concept_audio',
    file: 'concept_file',
    folder: 'concept_folder',
    
    // Abstract Concepts
    idea: 'concept_idea',
    concept: 'concept_concept',
    theory: 'concept_theory',
    principle: 'concept_principle',
    rule: 'concept_rule',
    pattern: 'concept_pattern',
    trend: 'concept_trend',
    
    // Problems and Solutions
    problem: 'concept_problem',
    issue: 'concept_issue',
    challenge: 'concept_challenge',
    solution: 'concept_solution',
    answer: 'concept_answer',
    resolution: 'concept_resolution',
    
    // Goals and Objectives
    goal: 'concept_goal',
    objective: 'concept_objective',
    target: 'concept_target',
    milestone: 'concept_milestone',
    achievement: 'concept_achievement',
    
    // Products and Services
    product: 'concept_product',
    feature: 'concept_feature',
    component: 'concept_component',
    module: 'concept_module',
    package: 'concept_package',
    
    // Communication
    conversation: 'concept_conversation',
    discussion: 'concept_discussion',
    dialogue: 'concept_dialogue',
    feedback: 'concept_feedback',
    response: 'concept_response',
    
    // Security
    security: 'concept_security',
    authentication: 'concept_authentication',
    authorization: 'concept_authorization',
    permission: 'concept_permission',
    credential: 'concept_credential',
    
    // Quality
    quality: 'concept_quality',
    standard: 'concept_standard',
    requirement: 'concept_requirement',
    specification: 'concept_specification',
    criterion: 'concept_criterion'
  },
  
  // ============= Properties =============
  properties: {
    // Identification
    name: 'prop_name',
    title: 'prop_title',
    id: 'prop_id',
    identifier: 'prop_identifier',
    label: 'prop_label',
    tag: 'prop_tag',
    
    // Description
    description: 'prop_description',
    summary: 'prop_summary',
    abstract: 'prop_abstract',
    content: 'prop_content',
    body: 'prop_body',
    text: 'prop_text',
    
    // Status and State
    status: 'prop_status',
    state: 'prop_state',
    phase: 'prop_phase',
    stage: 'prop_stage',
    condition: 'prop_condition',
    mode: 'prop_mode',
    
    // Quality and Characteristics
    quality: 'prop_quality',
    accuracy: 'prop_accuracy',
    precision: 'prop_precision',
    reliability: 'prop_reliability',
    performance: 'prop_performance',
    efficiency: 'prop_efficiency',
    
    // Sentiment and Emotion
    sentiment: 'prop_sentiment',
    emotion: 'prop_emotion',
    mood: 'prop_mood',
    tone: 'prop_tone',
    attitude: 'prop_attitude',
    
    // Importance and Priority
    priority: 'prop_priority',
    importance: 'prop_importance',
    urgency: 'prop_urgency',
    severity: 'prop_severity',
    criticality: 'prop_criticality',
    
    // Size and Quantity
    size: 'prop_size',
    length: 'prop_length',
    count: 'prop_count',
    quantity: 'prop_quantity',
    amount: 'prop_amount',
    volume: 'prop_volume',
    
    // Time Properties
    timestamp: 'prop_timestamp',
    duration: 'prop_duration',
    frequency: 'prop_frequency',
    interval: 'prop_interval',
    deadline: 'prop_deadline',
    
    // Location Properties
    location: 'prop_location',
    position: 'prop_position',
    coordinates: 'prop_coordinates',
    address: 'prop_address',
    region: 'prop_region',
    
    // Categorization
    category: 'prop_category',
    type: 'prop_type',
    class: 'prop_class',
    group: 'prop_group',
    domain: 'prop_domain',
    topic: 'prop_topic',
    
    // Relationships
    relationship: 'prop_relationship',
    connection: 'prop_connection',
    association: 'prop_association',
    dependency: 'prop_dependency',
    
    // Attributes
    color: 'prop_color',
    shape: 'prop_shape',
    texture: 'prop_texture',
    material: 'prop_material',
    style: 'prop_style',
    
    // Themes and Concepts
    theme: 'prop_theme',
    main_themes: 'prop_main_themes',
    key_points: 'prop_key_points',
    key_takeaways: 'prop_key_takeaways',
    highlights: 'prop_highlights',
    
    // Causes and Effects
    cause: 'prop_cause',
    effect: 'prop_effect',
    reason: 'prop_reason',
    purpose: 'prop_purpose',
    consequence: 'prop_consequence',
    impact: 'prop_impact',
    
    // Sources and Origins
    source: 'prop_source',
    origin: 'prop_origin',
    author: 'prop_author',
    creator: 'prop_creator',
    owner: 'prop_owner',
    
    // Targets and Destinations
    target: 'prop_target',
    destination: 'prop_destination',
    recipient: 'prop_recipient',
    audience: 'prop_audience',
    
    // Constraints
    constraint: 'prop_constraint',
    limitation: 'prop_limitation',
    restriction: 'prop_restriction',
    requirement: 'prop_requirement',
    
    // Metrics
    metric: 'prop_metric',
    score: 'prop_score',
    rating: 'prop_rating',
    rank: 'prop_rank',
    percentage: 'prop_percentage',
    ratio: 'prop_ratio',
    
    // Configuration
    configuration: 'prop_configuration',
    setting: 'prop_setting',
    parameter: 'prop_parameter',
    option: 'prop_option',
    preference: 'prop_preference',
    
    // Versions
    version: 'prop_version',
    revision: 'prop_revision',
    edition: 'prop_edition',
    release: 'prop_release'
  },
  
  // ============= Modifiers =============
  modifiers: {
    // Temporal
    latest: 'mod_latest',
    previous: 'mod_previous',
    current: 'mod_current',
    next: 'mod_next',
    recent: 'mod_recent',
    past: 'mod_past',
    future: 'mod_future',
    
    // Quantifiers
    all: 'mod_all',
    any: 'mod_any',
    some: 'mod_some',
    none: 'mod_none',
    each: 'mod_each',
    every: 'mod_every',
    most: 'mod_most',
    few: 'mod_few',
    many: 'mod_many',
    
    // Logical
    and: 'mod_and',
    or: 'mod_or',
    not: 'mod_not',
    if: 'mod_if',
    then: 'mod_then',
    else: 'mod_else',
    
    // Comparison
    more: 'mod_more',
    less: 'mod_less',
    equal: 'mod_equal',
    greater: 'mod_greater',
    lesser: 'mod_lesser',
    between: 'mod_between',
    
    // Definiteness
    definite: 'mod_definite',
    indefinite: 'mod_indefinite',
    specific: 'mod_specific',
    general: 'mod_general',
    
    // Certainty
    certain: 'mod_certain',
    probable: 'mod_probable',
    possible: 'mod_possible',
    unlikely: 'mod_unlikely',
    impossible: 'mod_impossible',
    
    // Speed
    fast: 'mod_fast',
    slow: 'mod_slow',
    quick: 'mod_quick',
    immediate: 'mod_immediate',
    gradual: 'mod_gradual',
    
    // Size
    large: 'mod_large',
    small: 'mod_small',
    medium: 'mod_medium',
    tiny: 'mod_tiny',
    huge: 'mod_huge',
    
    // Quality
    good: 'mod_good',
    bad: 'mod_bad',
    best: 'mod_best',
    worst: 'mod_worst',
    optimal: 'mod_optimal',
    
    // Position
    first: 'mod_first',
    last: 'mod_last',
    middle: 'mod_middle',
    beginning: 'mod_beginning',
    end: 'mod_end'
  },
  
  // ============= Relations =============
  relations: {
    // Spatial
    above: 'rel_above',
    below: 'rel_below',
    beside: 'rel_beside',
    between: 'rel_between',
    within: 'rel_within',
    outside: 'rel_outside',
    near: 'rel_near',
    far: 'rel_far',
    
    // Temporal
    before: 'rel_before',
    after: 'rel_after',
    during: 'rel_during',
    while: 'rel_while',
    since: 'rel_since',
    until: 'rel_until',
    
    // Logical
    causes: 'rel_causes',
    caused_by: 'rel_caused_by',
    results_in: 'rel_results_in',
    depends_on: 'rel_depends_on',
    influences: 'rel_influences',
    correlates_with: 'rel_correlates_with',
    
    // Hierarchical
    parent_of: 'rel_parent_of',
    child_of: 'rel_child_of',
    contains: 'rel_contains',
    contained_by: 'rel_contained_by',
    part_of: 'rel_part_of',
    has_part: 'rel_has_part',
    
    // Associative
    related_to: 'rel_related_to',
    associated_with: 'rel_associated_with',
    connected_to: 'rel_connected_to',
    linked_to: 'rel_linked_to',
    refers_to: 'rel_refers_to',
    
    // Comparative
    similar_to: 'rel_similar_to',
    different_from: 'rel_different_from',
    same_as: 'rel_same_as',
    opposite_of: 'rel_opposite_of',
    greater_than: 'rel_greater_than',
    less_than: 'rel_less_than',
    
    // Ownership
    owns: 'rel_owns',
    owned_by: 'rel_owned_by',
    belongs_to: 'rel_belongs_to',
    has: 'rel_has',
    
    // Communication
    sends_to: 'rel_sends_to',
    receives_from: 'rel_receives_from',
    responds_to: 'rel_responds_to',
    asks: 'rel_asks',
    answers: 'rel_answers'
  }
};

/**
 * Domain-specific primitive extensions
 * These can be loaded as plugins for specialized domains
 */
export const DomainPrimitives = {
  // Financial domain
  financial: {
    actions: {
      invest: 'action_invest',
      divest: 'action_divest',
      hedge: 'action_hedge',
      arbitrage: 'action_arbitrage'
    },
    concepts: {
      stock: 'concept_stock',
      bond: 'concept_bond',
      derivative: 'concept_derivative',
      portfolio: 'concept_portfolio'
    }
  },
  
  // Medical domain
  medical: {
    actions: {
      diagnose: 'action_diagnose',
      treat: 'action_treat',
      prescribe: 'action_prescribe',
      examine: 'action_examine'
    },
    concepts: {
      patient: 'concept_patient',
      symptom: 'concept_symptom',
      diagnosis: 'concept_diagnosis',
      treatment: 'concept_treatment'
    }
  },
  
  // Legal domain
  legal: {
    actions: {
      prosecute: 'action_prosecute',
      defend: 'action_defend',
      adjudicate: 'action_adjudicate',
      appeal: 'action_appeal'
    },
    concepts: {
      case: 'concept_case',
      law: 'concept_law',
      contract: 'concept_contract',
      verdict: 'concept_verdict'
    }
  }
};

/**
 * Utility function to get primitive by value
 */
export function getPrimitiveByValue(value: string): { type: string; key: string } | null {
  for (const [type, primitives] of Object.entries(CorePrimitives)) {
    for (const [key, val] of Object.entries(primitives)) {
      if (val === value) {
        return { type, key };
      }
    }
  }
  return null;
}

/**
 * Utility function to check if a value is a valid primitive
 */
export function isValidPrimitive(value: string): boolean {
  return getPrimitiveByValue(value) !== null;
}

/**
 * Export as default for easy importing
 */
export default CorePrimitives;
