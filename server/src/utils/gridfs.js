"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCheatingImagesBucket = getCheatingImagesBucket;
const mongoose_1 = __importDefault(require("mongoose"));
let cheatingImagesBucket = null;
/**
 * Returns a GridFS bucket for storing proctoring evidence images.
 * Bucket name: "cheatingImages"
 *
 * Make sure MongoDB is connected before calling this helper.
 */
function getCheatingImagesBucket() {
    if (!mongoose_1.default.connection.db) {
        throw new Error('MongoDB connection not ready. Cannot initialize GridFS bucket.');
    }
    if (!cheatingImagesBucket) {
        cheatingImagesBucket = new mongoose_1.default.mongo.GridFSBucket(mongoose_1.default.connection.db, {
            bucketName: 'cheatingImages',
        });
    }
    return cheatingImagesBucket;
}
