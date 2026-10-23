import mongoose from 'mongoose'
import { isValidHttpUrl } from '../utils/validation.js'

const linkSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    shortCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    originalUrl: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: isValidHttpUrl,
        message: 'originalUrl must be a valid HTTP or HTTPS URL.',
      },
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

linkSchema.index({ ownerId: 1, createdAt: -1, _id: -1 })

export const Link = mongoose.model('Link', linkSchema)

