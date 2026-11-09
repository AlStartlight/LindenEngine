/** Labels for img2threejs forge scripts (linden_img2_run), shared by the agent host and panel */

/** Short Indonesian label per script for the agent panel */
export const IMG2_SCRIPT_LABELS: Record<string, string> = {
  'next.py': 'Cek langkah berikutnya',
  'state.py': 'Status rekonstruksi',
  'report.py': 'Laporan rekonstruksi',
  'stage1_intake/probe_image.py': 'Periksa gambar referensi',
  'stage1_intake/build_detail_inventory.py': 'Inventaris detail',
  'stage1_intake/extract_pbr_evidence.py': 'Ekstrak bukti PBR',
  'stage1_intake/analyze_texture.py': 'Analisis tekstur',
  'stage1_intake/extract_landmarks.py': 'Landmark karakter',
  'stage1_intake/solve_camera_pose.py': 'Pose kamera referensi',
  'stage1_intake/delight_albedo.py': 'De-light albedo',
  'stage1_intake/material_region_analysis.py': 'Analisis region material',
  'stage2_spec/new_pre_spec_assessment.py': 'Penilaian awal (assessment)',
  'stage2_spec/new_sculpt_spec.py': 'Tulis sculpt spec',
  'stage2_spec/validate_sculpt_spec.py': 'Validasi spec',
  'stage2_spec/apply_material_analysis.py': 'Terapkan analisis material',
  'stage3_build/orchestrate_passes.py': 'Status pass build',
  'stage3_build/generate_threejs_factory.py': 'Generate factory Three.js',
  'stage4_review/make_comparison_sheet.py': 'Lembar perbandingan',
  'stage4_review/append_review.py': 'Catat review',
  'stage4_review/diagnose_render.py': 'Diagnosa render',
  'stage4_review/diagnose_render_multi_angle.py': 'Diagnosa multi-sudut',
  'stage4_review/turntable_gate.py': 'Gate turntable',
  'stage4_review/self_intersection.py': 'Gate self-intersection',
  'stage4_review/attachment_anchor.py': 'Gate attachment',
  'stage4_review/check_part_coverage.py': 'Cakupan part',
  'stage4_review/material_gate.py': 'Gate material',
}

export function img2ScriptLabel(script: string | undefined): string | null {
  if (!script) return null
  const s = script.trim().replace(/\\/g, '/').replace(/^python3?\s+/, '').replace(/^\.\//, '').replace(/^forge\//, '')
  return IMG2_SCRIPT_LABELS[s] ?? s.split('/').pop()!.replace(/\.py$/, '').replace(/_/g, ' ')
}
