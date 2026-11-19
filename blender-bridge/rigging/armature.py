# SPDX-License-Identifier: GPL-3.0-or-later
#
# Standard bipedal armature generation & skinning for Linden Engine.
# Copyright (C) 2026 Linden Engine Contributors

import math
import bpy
from mathutils import Vector


def get_meshes_bounds(meshes):
    if not meshes:
        return Vector((-0.5, -0.5, 0.0)), Vector((0.5, 0.5, 1.8))
    lo = Vector((math.inf, math.inf, math.inf))
    hi = Vector((-math.inf, -math.inf, -math.inf))
    for obj in meshes:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
    return lo, hi


def create_humanoid_armature(name="CharacterArmature", height=1.8, width=0.8, depth=0.4, base_z=0.0):
    """
    Creates a standard humanoid biped armature fitted to height/width/depth.
    All bone positions are oriented with Z-up, front along -Y (Blender default view towards -Y).
    """
    armature_data = bpy.data.armatures.new(name=name)
    armature_obj = bpy.data.objects.new(name=name, object_data=armature_data)
    bpy.context.scene.collection.objects.link(armature_obj)

    bpy.context.view_layer.objects.active = armature_obj
    armature_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bones = armature_data.edit_bones

    # Proportional heights relative to total height
    z0 = base_z
    z_hips = z0 + height * 0.53
    z_spine = z0 + height * 0.62
    z_chest = z0 + height * 0.74
    z_neck = z0 + height * 0.83
    z_head_top = z0 + height * 1.0

    arm_x = width * 0.22
    elbow_x = width * 0.40
    wrist_x = width * 0.55
    hand_x = width * 0.62
    shoulder_z = z0 + height * 0.73

    leg_x = width * 0.14
    knee_z = z0 + height * 0.29
    ankle_z = z0 + height * 0.09
    toe_z = z0 + height * 0.02
    foot_y_front = -depth * 0.35
    toe_y_front = -depth * 0.55

    # 1. Root & Torso
    root = bones.new("Root")
    root.head = (0.0, 0.0, z0)
    root.tail = (0.0, 0.0, z0 + height * 0.08)

    hips = bones.new("Hips")
    hips.head = (0.0, 0.0, z_hips)
    hips.tail = (0.0, 0.0, z_spine)
    hips.parent = root

    spine = bones.new("Spine")
    spine.head = (0.0, 0.0, z_spine)
    spine.tail = (0.0, 0.0, z_chest)
    spine.parent = hips
    spine.use_connect = True

    chest = bones.new("Chest")
    chest.head = (0.0, 0.0, z_chest)
    chest.tail = (0.0, 0.0, z_neck)
    chest.parent = spine
    chest.use_connect = True

    neck = bones.new("Neck")
    neck.head = (0.0, 0.0, z_neck)
    neck.tail = (0.0, 0.0, z_neck + height * 0.06)
    neck.parent = chest
    neck.use_connect = True

    head = bones.new("Head")
    head.head = (0.0, 0.0, z_neck + height * 0.06)
    head.tail = (0.0, 0.0, z_head_top)
    head.parent = neck
    head.use_connect = True

    # 2. Arms (Left and Right)
    for side, sign in (("L", 1.0), ("R", -1.0)):
        clavicle = bones.new("Clavicle.%s" % side)
        clavicle.head = (sign * width * 0.05, 0.0, shoulder_z)
        clavicle.tail = (sign * arm_x, 0.0, shoulder_z + height * 0.02)
        clavicle.parent = chest

        upper_arm = bones.new("UpperArm.%s" % side)
        upper_arm.head = clavicle.tail
        upper_arm.tail = (sign * elbow_x, 0.0, shoulder_z - height * 0.16)
        upper_arm.parent = clavicle

        forearm = bones.new("Forearm.%s" % side)
        forearm.head = upper_arm.tail
        forearm.tail = (sign * wrist_x, 0.0, shoulder_z - height * 0.32)
        forearm.parent = upper_arm
        forearm.use_connect = True

        hand = bones.new("Hand.%s" % side)
        hand.head = forearm.tail
        hand.tail = (sign * hand_x, 0.0, shoulder_z - height * 0.38)
        hand.parent = forearm
        hand.use_connect = True

    # 3. Legs (Left and Right)
    for side, sign in (("L", 1.0), ("R", -1.0)):
        thigh = bones.new("Thigh.%s" % side)
        thigh.head = (sign * leg_x, 0.0, z_hips)
        thigh.tail = (sign * leg_x, 0.0, knee_z)
        thigh.parent = hips

        shin = bones.new("Shin.%s" % side)
        shin.head = thigh.tail
        shin.tail = (sign * leg_x, 0.0, ankle_z)
        shin.parent = thigh
        shin.use_connect = True

        foot = bones.new("Foot.%s" % side)
        foot.head = shin.tail
        foot.tail = (sign * leg_x, foot_y_front, toe_z)
        foot.parent = shin

        toe = bones.new("Toe.%s" % side)
        toe.head = foot.tail
        toe.tail = (sign * leg_x, toe_y_front, z0)
        toe.parent = foot
        toe.use_connect = True

    bpy.ops.object.mode_set(mode="OBJECT")
    return armature_obj


def bind_meshes_to_armature(meshes, armature_obj, rig_type="humanoid_biped", rig_mapping=None):
    """
    Binds the given mesh objects to the armature using automatic weights or mechanical bone parenting.
    Ensures an Armature modifier exists on each mesh.
    """
    if not meshes or not armature_obj:
        return

    # Clear selections
    for o in bpy.context.view_layer.objects:
        o.select_set(False)

    if rig_type == "mechanical_biped" and rig_mapping:
        # Rigid bone parenting per object
        mapping_dict = {m["objectName"]: m["bone"] for m in rig_mapping}
        for obj in meshes:
            target_bone = mapping_dict.get(obj.name)
            if target_bone and target_bone in armature_obj.data.bones:
                obj.parent = armature_obj
                obj.parent_type = "BONE"
                obj.parent_bone = target_bone
            else:
                # Fallback to closest bone or Hips
                obj.parent = armature_obj
                obj.parent_type = "BONE"
                obj.parent_bone = "Hips"
        return

    # For smooth skinning (organic or joined mesh):
    for obj in meshes:
        for o in bpy.context.view_layer.objects:
            o.select_set(False)

        obj.select_set(True)
        armature_obj.select_set(True)
        bpy.context.view_layer.objects.active = armature_obj

        try:
            # Try heat weighting first
            bpy.ops.object.parent_set(type="ARMATURE_AUTO")
        except Exception:
            try:
                # Fallback to envelope weights if automatic heat failed
                bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")
            except Exception:
                # Safe fallback: empty vertex groups with armature modifier
                bpy.ops.object.parent_set(type="ARMATURE")

        # Verify Armature modifier is attached
        has_arm_mod = any(m.type == "ARMATURE" and m.object == armature_obj for m in obj.modifiers)
        if not has_arm_mod:
            m = obj.modifiers.new("Armature", "ARMATURE")
            m.object = armature_obj

    for o in bpy.context.view_layer.objects:
        o.select_set(False)
