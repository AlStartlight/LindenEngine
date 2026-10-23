import { test, expect } from '@playwright/test'
import { LayerMask } from '../../../engine/scene/LayerMask'
import { tcId } from './_helpers'

// 1.024 cases: hasLayer for every (mask layer, query layer) pair over 32 x 32 layers
test.describe('LayerMask.hasLayer', () => {
  let n = 0
  for (let maskLayer = 0; maskLayer < 32; maskLayer++) {
    for (let query = 0; query < 32; query++) {
      const expected = maskLayer === query
      test(`${tcId('LYR', ++n)} mask(1<<${maskLayer}) has layer ${query} = ${expected}`, () => {
        expect(LayerMask.hasLayer(1 << maskLayer, query)).toBe(expected)
        // A mask of every layer except maskLayer never contains it, and contains all others
        expect(LayerMask.hasLayer(~(1 << maskLayer), query)).toBe(!expected)
      })
    }
  }
})
