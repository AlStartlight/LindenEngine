# SPDX-License-Identifier: GPL-3.0-or-later
#
# Procedural locomotion animation clips generator for Linden Engine.
# Copyright (C) 2026 Linden Engine Contributors

import math
import bpy


def reset_pose(armature_obj):
    for pb in armature_obj.pose.bones:
        pb.rotation_mode = "XYZ"
        pb.location = (0.0, 0.0, 0.0)
        pb.rotation_euler = (0.0, 0.0, 0.0)


def insert_bone_key(armature_obj, bone_name, frame, loc=None, rot_deg=None):
    pb = armature_obj.pose.bones.get(bone_name)
    if not pb:
        return
    pb.rotation_mode = "XYZ"
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert(data_path="location", frame=frame)
    if rot_deg is not None:
        pb.rotation_euler = [math.radians(v) for v in rot_deg]
        pb.keyframe_insert(data_path="rotation_euler", frame=frame)


def ensure_animation_data(armature_obj):
    if not armature_obj.animation_data:
        armature_obj.animation_data_create()
    return armature_obj.animation_data


def stash_action(armature_obj, action):
    """Pushes action to an NLA track so glTF exporter preserves all named animation clips."""
    anim_data = ensure_animation_data(armature_obj)
    track = anim_data.nla_tracks.new()
    track.name = action.name
    start = int(action.frame_range[0])
    track.strips.new(action.name, start, action)


def generate_locomotion_actions(armature_obj, actions=None, height=1.8):
    """
    Generates procedural keyframes for standard bipedal locomotion.
    Clips produced: Idle, Walk, Run, Jump_Start, Fall, Land, Crouch_Idle, Crouch_Walk, Attack.
    """
    if actions is None:
        actions = ["idle", "walk", "run", "jump", "fall", "land", "crouch_idle", "crouch_walk", "attack"]

    actions_lower = {a.lower() for a in actions}
    scale = max(0.5, height / 1.8)

    # 1. Idle (60 frames, 2.0s loop @ 30 fps)
    if "idle" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Idle")
        ensure_animation_data(armature_obj).action = action

        for f, bob, spine_rx in ((1, 0.0, 0.0), (30, 0.02 * scale, -2.0), (60, 0.0, 0.0)):
            insert_bone_key(armature_obj, "Hips", f, loc=(0.0, 0.0, bob), rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Spine", f, rot_deg=(spine_rx, 0.0, 0.0))
            insert_bone_key(armature_obj, "Chest", f, rot_deg=(spine_rx * 0.5, 0.0, 0.0))
            insert_bone_key(armature_obj, "Head", f, rot_deg=(-spine_rx * 0.4, 0.0, 0.0))
            insert_bone_key(armature_obj, "UpperArm.L", f, rot_deg=(2.0, 0.0, 5.0))
            insert_bone_key(armature_obj, "UpperArm.R", f, rot_deg=(2.0, 0.0, -5.0))
            insert_bone_key(armature_obj, "Forearm.L", f, rot_deg=(12.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.R", f, rot_deg=(12.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 2. Walk (30 frames, 1.0s loop)
    if "walk" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Walk")
        ensure_animation_data(armature_obj).action = action

        # 4 phases: Contact L, Pass L, Contact R, Pass R, Contact L
        frames = [1, 8, 15, 22, 30]
        # Left leg: thigh, shin, foot rotX
        l_leg = [(-24.0, 4.0, 0.0), (0.0, 22.0, 6.0), (22.0, 8.0, -14.0), (-14.0, 36.0, 8.0), (-24.0, 4.0, 0.0)]
        # Right leg is offset by 15 frames
        r_leg = [(22.0, 8.0, -14.0), (-14.0, 36.0, 8.0), (-24.0, 4.0, 0.0), (0.0, 22.0, 6.0), (22.0, 8.0, -14.0)]
        # Pelvis bob
        hips_z = [0.0, -0.025 * scale, 0.0, -0.025 * scale, 0.0]

        for i, f in enumerate(frames):
            insert_bone_key(armature_obj, "Hips", f, loc=(0.0, 0.0, hips_z[i]), rot_deg=(0.0, 2.0 if i % 2 == 0 else -2.0, 0.0))
            # Left leg
            lt, ls, lf = l_leg[i]
            insert_bone_key(armature_obj, "Thigh.L", f, rot_deg=(lt, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.L", f, rot_deg=(ls, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.L", f, rot_deg=(lf, 0.0, 0.0))
            # Right leg
            rt, rs, rf = r_leg[i]
            insert_bone_key(armature_obj, "Thigh.R", f, rot_deg=(rt, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.R", f, rot_deg=(rs, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.R", f, rot_deg=(rf, 0.0, 0.0))
            # Arms swing opposite to legs
            insert_bone_key(armature_obj, "UpperArm.L", f, rot_deg=(-lt * 0.8, 0.0, 5.0))
            insert_bone_key(armature_obj, "UpperArm.R", f, rot_deg=(-rt * 0.8, 0.0, -5.0))
            insert_bone_key(armature_obj, "Forearm.L", f, rot_deg=(18.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.R", f, rot_deg=(18.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Spine", f, rot_deg=(-3.0, 0.0, -lt * 0.15))
        stash_action(armature_obj, action)

    # 3. Run (20 frames, 0.67s loop)
    if "run" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Run")
        ensure_animation_data(armature_obj).action = action

        frames = [1, 5, 10, 15, 20]
        l_leg = [(-42.0, 10.0, 0.0), (0.0, 55.0, 12.0), (35.0, 15.0, -22.0), (-25.0, 65.0, 15.0), (-42.0, 10.0, 0.0)]
        r_leg = [(35.0, 15.0, -22.0), (-25.0, 65.0, 15.0), (-42.0, 10.0, 0.0), (0.0, 55.0, 12.0), (35.0, 15.0, -22.0)]
        hips_z = [0.0, -0.05 * scale, 0.0, -0.05 * scale, 0.0]

        for i, f in enumerate(frames):
            insert_bone_key(armature_obj, "Hips", f, loc=(0.0, 0.0, hips_z[i]), rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Spine", f, rot_deg=(-12.0, 0.0, -l_leg[i][0] * 0.2))
            insert_bone_key(armature_obj, "Chest", f, rot_deg=(-4.0, 0.0, 0.0))
            # Left leg
            lt, ls, lf = l_leg[i]
            insert_bone_key(armature_obj, "Thigh.L", f, rot_deg=(lt, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.L", f, rot_deg=(ls, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.L", f, rot_deg=(lf, 0.0, 0.0))
            # Right leg
            rt, rs, rf = r_leg[i]
            insert_bone_key(armature_obj, "Thigh.R", f, rot_deg=(rt, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.R", f, rot_deg=(rs, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.R", f, rot_deg=(rf, 0.0, 0.0))
            # High energy arm swings with elbows bent 75 deg
            insert_bone_key(armature_obj, "UpperArm.L", f, rot_deg=(-lt * 1.1, 0.0, 10.0))
            insert_bone_key(armature_obj, "UpperArm.R", f, rot_deg=(-rt * 1.1, 0.0, -10.0))
            insert_bone_key(armature_obj, "Forearm.L", f, rot_deg=(65.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.R", f, rot_deg=(65.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 4. Jump_Start (12 frames, anticipation & explosive liftoff)
    if "jump" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Jump_Start")
        ensure_animation_data(armature_obj).action = action

        # Frame 1: Neutral
        insert_bone_key(armature_obj, "Hips", 1, loc=(0.0, 0.0, 0.0), rot_deg=(0.0, 0.0, 0.0))
        # Frame 5: Crouch anticipation
        insert_bone_key(armature_obj, "Hips", 5, loc=(0.0, 0.0, -0.12 * scale), rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "Spine", 5, rot_deg=(-10.0, 0.0, 0.0))
        for side in ("L", "R"):
            insert_bone_key(armature_obj, "Thigh.%s" % side, 5, rot_deg=(-30.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.%s" % side, 5, rot_deg=(55.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "UpperArm.%s" % side, 5, rot_deg=(25.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.%s" % side, 5, rot_deg=(15.0, 0.0, 0.0))
        # Frame 12: Extension thrust
        insert_bone_key(armature_obj, "Hips", 12, loc=(0.0, 0.0, 0.06 * scale), rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "Spine", 12, rot_deg=(6.0, 0.0, 0.0))
        for side in ("L", "R"):
            insert_bone_key(armature_obj, "Thigh.%s" % side, 12, rot_deg=(10.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.%s" % side, 12, rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.%s" % side, 12, rot_deg=(-35.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "UpperArm.%s" % side, 12, rot_deg=(-65.0, 0.0, 15.0 if side == "L" else -15.0))
            insert_bone_key(armature_obj, "Forearm.%s" % side, 12, rot_deg=(25.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 5. Fall / Jump_Loop (24 frames loop, floating in air)
    if "fall" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Fall")
        ensure_animation_data(armature_obj).action = action

        for f, bob in ((1, 0.0), (12, 0.03 * scale), (24, 0.0)):
            insert_bone_key(armature_obj, "Hips", f, loc=(0.0, 0.0, bob), rot_deg=(-5.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Spine", f, rot_deg=(-5.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Thigh.L", f, rot_deg=(-18.0, 0.0, 5.0))
            insert_bone_key(armature_obj, "Shin.L", f, rot_deg=(28.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.L", f, rot_deg=(-10.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Thigh.R", f, rot_deg=(-12.0, 0.0, -5.0))
            insert_bone_key(armature_obj, "Shin.R", f, rot_deg=(22.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.R", f, rot_deg=(-10.0, 0.0, 0.0))
            # Arms spread out for aerodynamic balance
            insert_bone_key(armature_obj, "UpperArm.L", f, rot_deg=(-20.0, 0.0, 35.0))
            insert_bone_key(armature_obj, "UpperArm.R", f, rot_deg=(-20.0, 0.0, -35.0))
            insert_bone_key(armature_obj, "Forearm.L", f, rot_deg=(30.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.R", f, rot_deg=(30.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 6. Land (10 frames, cushion & recovery)
    if "land" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Land")
        ensure_animation_data(armature_obj).action = action

        # Frame 1: Initial touch
        insert_bone_key(armature_obj, "Hips", 1, loc=(0.0, 0.0, 0.0), rot_deg=(0.0, 0.0, 0.0))
        # Frame 4: Max cushion compression
        insert_bone_key(armature_obj, "Hips", 4, loc=(0.0, 0.0, -0.15 * scale), rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "Spine", 4, rot_deg=(-15.0, 0.0, 0.0))
        for side in ("L", "R"):
            insert_bone_key(armature_obj, "Thigh.%s" % side, 4, rot_deg=(-35.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.%s" % side, 4, rot_deg=(60.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.%s" % side, 4, rot_deg=(-10.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "UpperArm.%s" % side, 4, rot_deg=(-25.0, 0.0, 15.0 if side == "L" else -15.0))
            insert_bone_key(armature_obj, "Forearm.%s" % side, 4, rot_deg=(40.0, 0.0, 0.0))
        # Frame 10: Restored neutral
        insert_bone_key(armature_obj, "Hips", 10, loc=(0.0, 0.0, 0.0), rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "Spine", 10, rot_deg=(0.0, 0.0, 0.0))
        for side in ("L", "R"):
            insert_bone_key(armature_obj, "Thigh.%s" % side, 10, rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Shin.%s" % side, 10, rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Foot.%s" % side, 10, rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "UpperArm.%s" % side, 10, rot_deg=(0.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.%s" % side, 10, rot_deg=(0.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 7. Crouch_Idle (45 frames loop)
    if "crouch_idle" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Crouch_Idle")
        ensure_animation_data(armature_obj).action = action

        for f, bob in ((1, 0.0), (22, 0.015 * scale), (45, 0.0)):
            insert_bone_key(armature_obj, "Hips", f, loc=(0.0, 0.0, -0.35 * scale + bob), rot_deg=(-10.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Spine", f, rot_deg=(-12.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Chest", f, rot_deg=(-6.0, 0.0, 0.0))
            for side in ("L", "R"):
                insert_bone_key(armature_obj, "Thigh.%s" % side, f, rot_deg=(-55.0, 0.0, 5.0 if side == "L" else -5.0))
                insert_bone_key(armature_obj, "Shin.%s" % side, f, rot_deg=(85.0, 0.0, 0.0))
                insert_bone_key(armature_obj, "Foot.%s" % side, f, rot_deg=(-15.0, 0.0, 0.0))
                insert_bone_key(armature_obj, "UpperArm.%s" % side, f, rot_deg=(-15.0, 0.0, 10.0 if side == "L" else -10.0))
                insert_bone_key(armature_obj, "Forearm.%s" % side, f, rot_deg=(45.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 8. Crouch_Walk (30 frames loop)
    if "crouch_walk" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Crouch_Walk")
        ensure_animation_data(armature_obj).action = action

        frames = [1, 8, 15, 22, 30]
        l_thigh = [-65.0, -45.0, -35.0, -50.0, -65.0]
        r_thigh = [-35.0, -50.0, -65.0, -45.0, -35.0]

        for i, f in enumerate(frames):
            insert_bone_key(armature_obj, "Hips", f, loc=(0.0, 0.0, -0.35 * scale), rot_deg=(-12.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Spine", f, rot_deg=(-15.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Thigh.L", f, rot_deg=(l_thigh[i], 0.0, 5.0))
            insert_bone_key(armature_obj, "Shin.L", f, rot_deg=(85.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Thigh.R", f, rot_deg=(r_thigh[i], 0.0, -5.0))
            insert_bone_key(armature_obj, "Shin.R", f, rot_deg=(85.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "UpperArm.L", f, rot_deg=(-l_thigh[i] * 0.4, 0.0, 10.0))
            insert_bone_key(armature_obj, "UpperArm.R", f, rot_deg=(-r_thigh[i] * 0.4, 0.0, -10.0))
            insert_bone_key(armature_obj, "Forearm.L", f, rot_deg=(50.0, 0.0, 0.0))
            insert_bone_key(armature_obj, "Forearm.R", f, rot_deg=(50.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    # 9. Attack (20 frames, right-hand punch/slash)
    if "attack" in actions_lower:
        reset_pose(armature_obj)
        action = bpy.data.actions.new("Attack")
        ensure_animation_data(armature_obj).action = action

        # Frame 1: Neutral
        insert_bone_key(armature_obj, "Spine", 1, rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "UpperArm.R", 1, rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "Forearm.R", 1, rot_deg=(0.0, 0.0, 0.0))
        # Frame 6: Wind-up
        insert_bone_key(armature_obj, "Spine", 6, rot_deg=(-5.0, 0.0, -18.0))
        insert_bone_key(armature_obj, "UpperArm.R", 6, rot_deg=(45.0, 30.0, -25.0))
        insert_bone_key(armature_obj, "Forearm.R", 6, rot_deg=(85.0, 0.0, 0.0))
        # Frame 12: Strike / Thrust
        insert_bone_key(armature_obj, "Spine", 12, rot_deg=(-10.0, 0.0, 22.0))
        insert_bone_key(armature_obj, "UpperArm.R", 12, rot_deg=(-70.0, -15.0, -10.0))
        insert_bone_key(armature_obj, "Forearm.R", 12, rot_deg=(15.0, 0.0, 0.0))
        # Frame 20: Recovery
        insert_bone_key(armature_obj, "Spine", 20, rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "UpperArm.R", 20, rot_deg=(0.0, 0.0, 0.0))
        insert_bone_key(armature_obj, "Forearm.R", 20, rot_deg=(0.0, 0.0, 0.0))
        stash_action(armature_obj, action)

    reset_pose(armature_obj)
