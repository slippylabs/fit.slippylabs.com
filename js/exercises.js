/* SlipFit exercise library.
 *
 * Each row: [id, name, group, pattern, equipment, type, cues]
 *   group     what the picker filters by and what weekly-volume charts count
 *   pattern   the movement slot the plan generator fills (squat, hinge, hpush...)
 *   equipment barbell | dumbbell | machine | cable | kettlebell | band | bodyweight | cardio
 *   type      w = load x reps, b = bodyweight reps (load optional), t = timed hold (s),
 *             c = cardio (minutes + distance), m = mobility (minutes)
 *
 * IDs are stored in every logged workout, so an id must never be renamed or
 * reused. Add new rows at the end of their group; retire one by leaving it.
 */
(function (root) {
  'use strict';

  const ROWS = [
    // ---- chest ----
    ['bench', 'Barbell Bench Press', 'chest', 'hpush', 'barbell', 'w', 'Shoulder blades pinned back, feet planted. Lower to mid-chest, press up and slightly back.'],
    ['incline-bench', 'Incline Barbell Bench', 'chest', 'hpush', 'barbell', 'w', 'Bench at 30-45°. Bar touches upper chest, elbows about 45° from your sides.'],
    ['db-bench', 'Dumbbell Bench Press', 'chest', 'hpush', 'dumbbell', 'w', 'Dumbbells over your chest, lower until a stretch at the pecs, press together at the top.'],
    ['db-incline', 'Incline Dumbbell Press', 'chest', 'hpush', 'dumbbell', 'w', 'Bench at 30°. Control the descent; do not let the elbows flare straight out.'],
    ['machine-press', 'Machine Chest Press', 'chest', 'hpush', 'machine', 'w', 'Handles at mid-chest height. Push without letting the shoulders roll forward.'],
    ['pushup', 'Push-Up', 'chest', 'hpush', 'bodyweight', 'b', 'Body in one straight line, hands under shoulders, chest to a fist from the floor.'],
    ['incline-pushup', 'Incline Push-Up', 'chest', 'hpush', 'bodyweight', 'b', 'Hands on a bench or counter. Easier than the floor; lower the surface as you get stronger.'],
    ['dips', 'Dips', 'chest', 'hpush', 'bodyweight', 'b', 'Lean slightly forward, lower until upper arms are parallel, press to lockout.'],
    ['cable-fly', 'Cable Fly', 'chest', 'chest_iso', 'cable', 'w', 'Soft bend in the elbows, hug a big tree, squeeze the chest where the hands meet.'],
    ['db-fly', 'Dumbbell Fly', 'chest', 'chest_iso', 'dumbbell', 'w', 'Lower in a wide arc to a stretch, keep the elbow angle fixed, bring them back over.'],
    ['pec-deck', 'Pec Deck', 'chest', 'chest_iso', 'machine', 'w', 'Seat so handles are at chest height. Squeeze together, return slowly.'],
    ['band-press', 'Band Chest Press', 'chest', 'hpush', 'band', 'b', 'Band behind your back, press forward until arms are straight, resist on the way back.'],

    // ---- back ----
    ['deadlift', 'Deadlift', 'back', 'hinge', 'barbell', 'w', 'Bar over mid-foot, flat back, push the floor away. Lock out with the glutes, not the low back.'],
    ['row', 'Barbell Row', 'back', 'hpull', 'barbell', 'w', 'Hinge to about 45°, pull the bar to your lower ribs, pause, lower under control.'],
    ['db-row', 'One-Arm Dumbbell Row', 'back', 'hpull', 'dumbbell', 'w', 'Hand and knee on a bench, pull the dumbbell to your hip, keep the torso still.'],
    ['cable-row', 'Seated Cable Row', 'back', 'hpull', 'cable', 'w', 'Chest tall, pull the handle to your belly button, squeeze the shoulder blades.'],
    ['chest-row', 'Chest-Supported Row', 'back', 'hpull', 'machine', 'w', 'Chest on the pad so the low back stays out of it. Pull elbows back past your torso.'],
    ['pullup', 'Pull-Up', 'back', 'vpull', 'bodyweight', 'b', 'Overhand grip, start from a dead hang, pull until your chin clears the bar.'],
    ['chinup', 'Chin-Up', 'back', 'vpull', 'bodyweight', 'b', 'Underhand shoulder-width grip. More biceps than a pull-up; same full range.'],
    ['lat-pulldown', 'Lat Pulldown', 'back', 'vpull', 'cable', 'w', 'Lean back slightly, pull the bar to your upper chest, elbows down and back.'],
    ['assisted-pullup', 'Assisted Pull-Up', 'back', 'vpull', 'machine', 'w', 'Log the assistance used; less assistance over time is progress.'],
    ['inverted-row', 'Inverted Row', 'back', 'hpull', 'bodyweight', 'b', 'Under a bar or sturdy table, body straight, pull your chest up to it.'],
    ['band-row', 'Band Row', 'back', 'hpull', 'band', 'b', 'Anchor the band at chest height, pull elbows back, hold a second.'],
    ['band-pulldown', 'Band Pulldown', 'back', 'vpull', 'band', 'b', 'Anchor high, kneel, pull the band down to your chest.'],
    ['kb-row', 'Kettlebell Row', 'back', 'hpull', 'kettlebell', 'w', 'Staggered stance, hand on a support, row the bell to your hip.'],
    ['rdl', 'Romanian Deadlift', 'back', 'hinge', 'barbell', 'w', 'Soft knees, push the hips back until you feel the hamstrings, keep the bar on your legs.'],
    ['db-rdl', 'Dumbbell Romanian Deadlift', 'back', 'hinge', 'dumbbell', 'w', 'Hips back, dumbbells slide down the thighs, flat back, stand by squeezing the glutes.'],
    ['back-ext', 'Back Extension', 'back', 'hinge', 'machine', 'b', 'Hinge at the hips over the pad, rise to a straight line, do not hyperextend.'],
    ['superman', 'Superman', 'back', 'hinge', 'bodyweight', 'b', 'Face down, lift arms and legs together, hold briefly, lower slowly.'],
    ['shrug', 'Dumbbell Shrug', 'back', 'shrug', 'dumbbell', 'w', 'Shoulders straight up toward the ears, pause, lower. No rolling.'],
    ['face-pull', 'Face Pull', 'shoulders', 'rear_delt', 'cable', 'w', 'Rope at face height, pull toward your forehead, hands apart, elbows high.'],

    // ---- shoulders ----
    ['ohp', 'Overhead Press', 'shoulders', 'vpush', 'barbell', 'w', 'Squeeze glutes, bar from collarbone to overhead, head through at the top.'],
    ['db-ohp', 'Dumbbell Shoulder Press', 'shoulders', 'vpush', 'dumbbell', 'w', 'Seated or standing, dumbbells at ear height, press up without arching.'],
    ['machine-ohp', 'Machine Shoulder Press', 'shoulders', 'vpush', 'machine', 'w', 'Handles start at shoulder height, press to near-lockout.'],
    ['pike-pushup', 'Pike Push-Up', 'shoulders', 'vpush', 'bodyweight', 'b', 'Hips high in an upside-down V, lower your head toward the floor between your hands.'],
    ['kb-press', 'Kettlebell Press', 'shoulders', 'vpush', 'kettlebell', 'w', 'Bell in the rack position, press straight up, wrist stacked over the elbow.'],
    ['band-ohp', 'Band Overhead Press', 'shoulders', 'vpush', 'band', 'b', 'Stand on the band, press the handles overhead.'],
    ['lateral-raise', 'Lateral Raise', 'shoulders', 'lat_raise', 'dumbbell', 'w', 'Lead with the elbows, raise to shoulder height, pinkies not higher than thumbs.'],
    ['cable-lateral', 'Cable Lateral Raise', 'shoulders', 'lat_raise', 'cable', 'w', 'Cable across your body, raise out to the side, constant tension.'],
    ['band-lateral', 'Band Lateral Raise', 'shoulders', 'lat_raise', 'band', 'b', 'Stand on the band, raise out to the side to shoulder height.'],
    ['rear-fly', 'Rear Delt Fly', 'shoulders', 'rear_delt', 'dumbbell', 'w', 'Bent over, arms out wide like wings, squeeze the back of the shoulders.'],
    ['band-pull-apart', 'Band Pull-Apart', 'shoulders', 'rear_delt', 'band', 'b', 'Arms straight in front, pull the band apart to your chest.'],
    ['arnold', 'Arnold Press', 'shoulders', 'vpush', 'dumbbell', 'w', 'Start palms facing you, rotate out as you press overhead.'],

    // ---- arms ----
    ['curl', 'Barbell Curl', 'biceps', 'bicep', 'barbell', 'w', 'Elbows pinned at your sides, curl without swinging, lower slowly.'],
    ['db-curl', 'Dumbbell Curl', 'biceps', 'bicep', 'dumbbell', 'w', 'Turn the palms up as you curl, full stretch at the bottom.'],
    ['hammer-curl', 'Hammer Curl', 'biceps', 'bicep', 'dumbbell', 'w', 'Palms facing each other the whole way.'],
    ['cable-curl', 'Cable Curl', 'biceps', 'bicep', 'cable', 'w', 'Constant tension; stand tall and keep the elbows still.'],
    ['band-curl', 'Band Curl', 'biceps', 'bicep', 'band', 'b', 'Stand on the band, curl to the shoulders.'],
    ['triceps-pushdown', 'Triceps Pushdown', 'triceps', 'tricep', 'cable', 'w', 'Elbows at your sides, push the bar or rope down to lockout.'],
    ['skullcrusher', 'Skull Crusher', 'triceps', 'tricep', 'barbell', 'w', 'Lower the bar toward your forehead, elbows pointing up, extend.'],
    ['oh-extension', 'Overhead Triceps Extension', 'triceps', 'tricep', 'dumbbell', 'w', 'One dumbbell held overhead, lower behind your head, extend.'],
    ['close-bench', 'Close-Grip Bench Press', 'triceps', 'hpush', 'barbell', 'w', 'Hands shoulder-width, elbows tucked, touch lower chest.'],
    ['diamond-pushup', 'Diamond Push-Up', 'triceps', 'tricep', 'bodyweight', 'b', 'Hands together under your chest in a diamond, elbows back.'],
    ['bench-dip', 'Bench Dip', 'triceps', 'tricep', 'bodyweight', 'b', 'Hands on a bench behind you, lower until elbows reach 90°.'],
    ['band-pushdown', 'Band Pushdown', 'triceps', 'tricep', 'band', 'b', 'Anchor high, push the band down to lockout.'],

    // ---- legs ----
    ['squat', 'Back Squat', 'legs', 'squat', 'barbell', 'w', 'Brace, sit between your heels, knees track over toes, hip crease below knee if you can.'],
    ['front-squat', 'Front Squat', 'legs', 'squat', 'barbell', 'w', 'Bar on the front of the shoulders, elbows high, stay upright.'],
    ['goblet-squat', 'Goblet Squat', 'legs', 'squat', 'dumbbell', 'w', 'Hold a dumbbell at your chest, sit down between your knees, chest up.'],
    ['kb-goblet', 'Kettlebell Goblet Squat', 'legs', 'squat', 'kettlebell', 'w', 'Bell held by the horns at your chest, squat deep, drive up.'],
    ['leg-press', 'Leg Press', 'legs', 'squat', 'machine', 'w', 'Feet shoulder-width, lower until knees near 90°, do not lock the knees hard.'],
    ['hack-squat', 'Hack Squat', 'legs', 'squat', 'machine', 'w', 'Back flat on the pad, deep squat, drive through the whole foot.'],
    ['bw-squat', 'Bodyweight Squat', 'legs', 'squat', 'bodyweight', 'b', 'Arms forward for balance, sit back and down, stand tall.'],
    ['jump-squat', 'Jump Squat', 'legs', 'plyo', 'bodyweight', 'b', 'Quarter-to-half squat then explode up; land softly into the next rep.'],
    ['lunge', 'Walking Lunge', 'legs', 'lunge', 'dumbbell', 'w', 'Long step, back knee toward the floor, push off the front heel. Reps per leg.'],
    ['bw-lunge', 'Bodyweight Lunge', 'legs', 'lunge', 'bodyweight', 'b', 'Step forward, both knees to 90°, push back up. Reps per leg.'],
    ['split-squat', 'Bulgarian Split Squat', 'legs', 'lunge', 'dumbbell', 'w', 'Rear foot on a bench, drop straight down, front shin mostly vertical. Reps per leg.'],
    ['bw-split-squat', 'Bodyweight Split Squat', 'legs', 'lunge', 'bodyweight', 'b', 'Rear foot on a chair or couch, lower under control. Reps per leg.'],
    ['step-up', 'Step-Up', 'legs', 'lunge', 'dumbbell', 'w', 'Whole foot on the box, drive up through that heel, step down slowly.'],
    ['leg-ext', 'Leg Extension', 'legs', 'quad_iso', 'machine', 'w', 'Pad on the shins, extend to straight, pause, lower slowly.'],
    ['leg-curl', 'Leg Curl', 'legs', 'ham_iso', 'machine', 'w', 'Curl the pad toward your glutes, keep the hips down.'],
    ['nordic', 'Nordic Curl (assisted)', 'legs', 'ham_iso', 'bodyweight', 'b', 'Feet anchored, lower your body forward as slowly as you can, push back up with hands.'],
    ['slider-curl', 'Slider Hamstring Curl', 'legs', 'ham_iso', 'bodyweight', 'b', 'On your back, heels on towels, bridge up and curl the heels in.'],
    ['hip-thrust', 'Hip Thrust', 'legs', 'glute', 'barbell', 'w', 'Upper back on a bench, bar on hips, drive up until hips are level, squeeze.'],
    ['glute-bridge', 'Glute Bridge', 'legs', 'glute', 'bodyweight', 'b', 'On your back, feet flat, push hips up, squeeze at the top for a second.'],
    ['kb-swing', 'Kettlebell Swing', 'legs', 'hinge', 'kettlebell', 'w', 'Hike the bell back, snap the hips forward, let it float to chest height.'],
    ['calf-raise', 'Standing Calf Raise', 'legs', 'calf', 'machine', 'w', 'Full stretch at the bottom, rise all the way up, pause.'],
    ['db-calf', 'Dumbbell Calf Raise', 'legs', 'calf', 'dumbbell', 'w', 'Ball of foot on a step, dumbbell in one hand, full range.'],
    ['bw-calf', 'Bodyweight Calf Raise', 'legs', 'calf', 'bodyweight', 'b', 'On a step for range, slow on the way down.'],
    ['wall-sit', 'Wall Sit', 'legs', 'squat', 'bodyweight', 't', 'Back on the wall, thighs parallel to the floor. Log seconds held.'],
    ['sumo-dl', 'Sumo Deadlift', 'legs', 'hinge', 'barbell', 'w', 'Wide stance, hands inside the knees, push the knees out, chest up.'],
    ['db-sumo', 'Dumbbell Sumo Squat', 'legs', 'squat', 'dumbbell', 'w', 'Wide stance, toes out, dumbbell hanging between the legs.'],
    ['single-leg-rdl', 'Single-Leg RDL', 'legs', 'hinge', 'bodyweight', 'b', 'Balance on one leg, hinge forward, back leg straight behind you. Reps per leg.'],
    ['band-good-morning', 'Band Good Morning', 'legs', 'hinge', 'band', 'b', 'Band under the feet and behind the neck, hinge forward, stand tall.'],

    // ---- core ----
    ['plank', 'Plank', 'core', 'core', 'bodyweight', 't', 'Forearms down, body straight, squeeze glutes and abs. Log seconds.'],
    ['side-plank', 'Side Plank', 'core', 'core', 'bodyweight', 't', 'On one forearm, hips up in a straight line. Seconds per side.'],
    ['dead-bug', 'Dead Bug', 'core', 'core', 'bodyweight', 'b', 'Low back pressed down, extend opposite arm and leg, return. Reps per side.'],
    ['hanging-raise', 'Hanging Leg Raise', 'core', 'core', 'bodyweight', 'b', 'Hang from a bar, raise knees or straight legs without swinging.'],
    ['crunch', 'Crunch', 'core', 'core', 'bodyweight', 'b', 'Curl the ribs toward the hips; the low back stays down.'],
    ['cable-crunch', 'Cable Crunch', 'core', 'core', 'cable', 'w', 'Kneel, rope behind your head, crunch down by flexing the spine.'],
    ['ab-wheel', 'Ab Wheel Rollout', 'core', 'core', 'bodyweight', 'b', 'From the knees, roll out as far as you can keep a flat back, pull back.'],
    ['russian-twist', 'Russian Twist', 'core', 'core', 'bodyweight', 'b', 'Lean back, rotate side to side. Each side counts as one.'],
    ['pallof', 'Pallof Press', 'core', 'core', 'cable', 'w', 'Stand side-on to the cable, press straight out and resist the twist.'],
    ['mountain-climber', 'Mountain Climbers', 'core', 'core', 'bodyweight', 'b', 'Plank position, drive the knees to the chest quickly.'],
    ['bird-dog', 'Bird Dog', 'core', 'core', 'bodyweight', 'b', 'On all fours, reach the opposite arm and leg long, hold, switch.'],
    ['hollow-hold', 'Hollow Body Hold', 'core', 'core', 'bodyweight', 't', 'On your back, arms and legs off the floor, low back glued down.'],
    ['farmer-carry', "Farmer's Carry", 'core', 'carry', 'dumbbell', 'w', 'Heavy dumbbells at your sides, walk tall. Log weight and seconds as reps.'],
    ['kb-carry', 'Kettlebell Carry', 'core', 'carry', 'kettlebell', 'w', 'Bell at your side or in the rack, walk tall for distance.'],

    // ---- cardio ----
    ['run', 'Run', 'cardio', 'cardio', 'cardio', 'c', 'Conversational pace for easy runs; you should be able to speak in sentences.'],
    ['walk', 'Walk', 'cardio', 'cardio', 'cardio', 'c', 'Brisk enough to raise your breathing. Great for recovery days.'],
    ['run-intervals', 'Run / Walk Intervals', 'cardio', 'cardio', 'cardio', 'c', 'Alternate jogging and walking as the plan says.'],
    ['treadmill', 'Treadmill', 'cardio', 'cardio', 'cardio', 'c', 'Set a 1% incline to match outdoor effort.'],
    ['bike', 'Cycling', 'cardio', 'cardio', 'cardio', 'c', 'Indoor or outdoor; keep cadence around 80-90 rpm.'],
    ['rower', 'Rowing Machine', 'cardio', 'cardio', 'cardio', 'c', 'Legs, then hips, then arms; reverse on the way back.'],
    ['elliptical', 'Elliptical', 'cardio', 'cardio', 'cardio', 'c', 'Stand tall, push and pull with the arms too.'],
    ['stairs', 'Stair Climber', 'cardio', 'cardio', 'cardio', 'c', 'Do not lean on the rails; light fingertips only.'],
    ['swim', 'Swim', 'cardio', 'cardio', 'cardio', 'c', 'Any stroke. Log distance in km (1 km = 40 lengths of 25 m).'],
    ['jump-rope', 'Jump Rope', 'cardio', 'cardio', 'cardio', 'c', 'Small hops on the balls of your feet, wrists turn the rope.'],
    ['hiit', 'HIIT Circuit', 'cardio', 'cardio', 'cardio', 'c', 'Hard work intervals with short rests. Log total minutes.'],
    ['burpee', 'Burpee', 'cardio', 'plyo', 'bodyweight', 'b', 'Squat, kick back to a plank, push-up optional, jump up.'],
    ['jumping-jack', 'Jumping Jacks', 'cardio', 'plyo', 'bodyweight', 'b', 'Classic warm-up; arms overhead as the feet go wide.'],
    ['high-knees', 'High Knees', 'cardio', 'plyo', 'bodyweight', 'b', 'Run in place driving the knees to hip height.'],
    ['hike', 'Hike', 'cardio', 'cardio', 'cardio', 'c', 'Hills count double in effort; log the time and distance.'],

    // ---- mobility ----
    ['stretch', 'Full-Body Stretch', 'mobility', 'mobility', 'bodyweight', 'm', 'Hold each stretch 30 s, breathe slowly, no bouncing.'],
    ['yoga', 'Yoga Flow', 'mobility', 'mobility', 'bodyweight', 'm', 'Follow a flow at your level; log minutes.'],
    ['foam-roll', 'Foam Rolling', 'mobility', 'mobility', 'bodyweight', 'm', 'Roll slowly, pause on tight spots for 20-30 s.'],
    ['hip-opener', 'Hip Opener Routine', 'mobility', 'mobility', 'bodyweight', 'm', '90/90 switches, pigeon, couch stretch: 1 min each side.'],
    ['shoulder-mob', 'Shoulder Mobility', 'mobility', 'mobility', 'band', 'm', 'Band dislocates, wall slides, sleeper stretch.'],
    ['cat-cow', 'Cat-Cow', 'mobility', 'mobility', 'bodyweight', 'b', 'On all fours, round then arch the spine slowly with your breath.'],
    ['worlds-greatest', "World's Greatest Stretch", 'mobility', 'mobility', 'bodyweight', 'b', 'Lunge, elbow to instep, rotate and reach up. Reps per side.'],
    ['meditate', 'Breathing / Meditation', 'mobility', 'mobility', 'bodyweight', 'm', 'Box breathing: in 4, hold 4, out 4, hold 4.'],
  ];

  const GROUPS = [
    ['chest', 'Chest'], ['back', 'Back'], ['shoulders', 'Shoulders'], ['biceps', 'Biceps'],
    ['triceps', 'Triceps'], ['legs', 'Legs'], ['core', 'Core'], ['cardio', 'Cardio'], ['mobility', 'Mobility'],
  ];

  const TYPE_LABEL = { w: 'Weight × reps', b: 'Reps', t: 'Seconds', c: 'Minutes + distance', m: 'Minutes' };

  const LIST = ROWS.map(function (r) {
    return { id: r[0], name: r[1], group: r[2], pattern: r[3], equip: r[4], type: r[5], cues: r[6] };
  });
  const BY_ID = {};
  LIST.forEach(function (e) { BY_ID[e.id] = e; });

  /* An exercise a user made up. Stored in state.custom and merged in at load. */
  function addCustom(list) {
    (list || []).forEach(function (e) {
      if (e && e.id && !BY_ID[e.id]) { e.custom = true; LIST.push(e); BY_ID[e.id] = e; }
    });
  }

  function get(id) {
    return BY_ID[id] || { id: id, name: id, group: 'other', pattern: 'other', equip: 'bodyweight', type: 'w', cues: '' };
  }

  const api = { LIST: LIST, GROUPS: GROUPS, TYPE_LABEL: TYPE_LABEL, get: get, addCustom: addCustom, byId: BY_ID };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FitEx = api;
})(this);
