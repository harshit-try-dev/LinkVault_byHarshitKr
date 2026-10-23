import mongoose from 'mongoose'

const clickSchema = new mongoose.Schema({
  linkId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Link',
    required: true,
  },
  clickedAt: {
    type: Date,
    required: true,
    default: Date.now,
  },
})

clickSchema.index({ linkId: 1, clickedAt: -1 })

export const Click = mongoose.model('Click', clickSchema)

