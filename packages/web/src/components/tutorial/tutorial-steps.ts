export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  /** null = centered modal with no spotlight */
  targetKey: string | null;
  placement: 'top' | 'bottom' | 'left' | 'right' | 'center';
  /** If set, navigate to this route before showing the step */
  route?: string;
}

export const TUTORIAL_STEPS: TutorialStep[] = [
  // ── Welcome ──
  {
    id: 'welcome',
    title: 'Welcome to FitTrackr!',
    body: "Let’s take a quick tour of everything you can do. It’ll only take a minute!",
    targetKey: null,
    placement: 'center',
    route: '/dashboard',
  },

  // ── Dashboard ──
  {
    id: 'volume-rings',
    title: 'Weekly Volume Rings',
    body: 'These rings show how many sets you’ve done for each muscle group this week versus your target. Tap any ring to see details. The streak counter shows how many days in a row you’ve trained.',
    targetKey: 'volume-rings',
    placement: 'bottom',
  },
  {
    id: 'start-workout',
    title: 'Start a Workout',
    body: 'Tap here to log your first workout, or use the quick-start buttons on the Workouts page to launch a Push, Pull, Legs, or Full Body session instantly.',
    targetKey: 'start-workout',
    placement: 'bottom',
  },

  // ── Workouts ──
  {
    id: 'workout-types',
    title: 'Quick-Start Workouts',
    body: 'Pick a workout type to create a session instantly. Tap the workout to open the logger and start adding exercises and sets.',
    targetKey: 'workout-quick-start',
    placement: 'bottom',
    route: '/workouts',
  },
  {
    id: 'workout-logger',
    title: 'Logging Sets',
    body: 'Search for an exercise, then log sets with weight, reps, and optional RPE. The weight field supports math — type "45+10+5" to sum plates. Hit Add Set to record another set for the same exercise.',
    targetKey: null,
    placement: 'center',
  },
  {
    id: 'rest-timer',
    title: 'Rest Timer',
    body: 'Tap the timer icon to open the rest timer. Choose a preset (60s, 90s, 2min, 3min) and you’ll get a notification when it’s time to lift again — even if you lock your phone.',
    targetKey: null,
    placement: 'center',
  },

  // ── Exercises ──
  {
    id: 'exercise-library',
    title: 'Exercise Library',
    body: 'Browse and filter over 300 exercises by name or muscle group. Each exercise shows primary and secondary muscles, equipment, and instructions.',
    targetKey: null,
    placement: 'center',
    route: '/exercises',
  },

  // ── Trends ──
  {
    id: 'trends',
    title: 'Track Your Progress',
    body: 'The Training tab shows weekly volume bars per muscle group. Switch to the Body tab to see weight, body fat, and measurement trends over 30 days.',
    targetKey: 'trends-tabs',
    placement: 'bottom',
    route: '/trends',
  },

  // ── Programs / AI ──
  {
    id: 'programs',
    title: 'AI Training Programs',
    body: 'Generate a personalized multi-week training program with AI. Set your goal, experience level, duration, and days per week — the AI builds a progressive overload plan. Supports OpenAI, Anthropic, and Gemini (BYOAI).',
    targetKey: 'program-generator',
    placement: 'bottom',
    route: '/programs',
  },
  {
    id: 'training-goals',
    title: 'Volume Targets',
    body: 'Generate AI-powered weekly set targets per muscle group. These populate the ring targets on your dashboard so you always know how much more volume each muscle needs.',
    targetKey: 'training-goal-generator',
    placement: 'bottom',
    route: '/training-goals',
  },

  // ── Profile ──
  {
    id: 'profile-settings',
    title: 'Profile & Biometrics',
    body: 'Set up your height, birthday, sex, and activity level. Your weight is tracked automatically from the Measurements tab.',
    targetKey: 'profile-tab-bar',
    placement: 'bottom',
    route: '/profile',
  },
  {
    id: 'body-tracking',
    title: 'Body Measurements',
    body: 'Switch to Measurements to log weigh-ins, body fat %, lean mass, and 12 circumference measurements. Track progress photos in the Photos tab!',
    targetKey: 'bio-sub-tabs',
    placement: 'bottom',
  },

  // ── Finish ──
  {
    id: 'finish',
    title: "You’re All Set!",
    body: 'Start logging your workouts! You can restart this tutorial anytime from Profile → Settings.',
    targetKey: null,
    placement: 'center',
  },
];
