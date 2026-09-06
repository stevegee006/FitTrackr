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
    id: 'ai-coach',
    title: 'AI Coach',
    body: 'Tap AI Coach any time for a read on your last 30 days — what’s working, what’s lagging, and what to prioritise next week. It uses your own logged sets, so the advice is about you rather than generic tips.',
    targetKey: 'ai-coach',
    placement: 'bottom',
  },
  {
    id: 'start-workout',
    title: 'Start a Workout',
    body: 'Tap a type to create a session instantly — Push, Pull, Legs, Full Body, or one of the others below.',
    // NOT 'start-workout': that element only exists in the empty state, so the
    // tour dead-ended here for anyone who had already trained this week.
    targetKey: 'quick-start',
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
    body: 'Check off a set and the rest timer pops up automatically — add or take off 10 seconds, or skip it. Choose a preset (60s, 90s, 2min, 3min) to set your default, or tap the timer icon any time to start a rest.',
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
    body: 'Tap Generate to build a personalised multi-week program with AI. Pick your goal, experience level, duration, and days per week, and it writes a progressive overload plan. Works with OpenAI, Anthropic, or Gemini — your own key.',
    targetKey: 'program-generator',
    placement: 'bottom',
    route: '/programs',
  },
  {
    id: 'training-goals',
    title: 'Volume Targets',
    body: 'Tap Generate for AI weekly set targets per muscle group. These become the ring targets on your dashboard, so you always know how much volume each muscle still needs.',
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
