import mongoose from 'mongoose';

export const ROLES = ['student', 'teacher', 'admin'];

const userSchema = new mongoose.Schema(
  {
    googleId: { type: String, index: true, sparse: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, default: '' },
    picture: { type: String, default: '' },
    role: { type: String, enum: ROLES, default: 'student', index: true },

    /**
     * Which department this member of staff belongs to.
     *
     * An `admin` is a head of department, not a college-wide superuser: they
     * appoint the teachers in their own department and see their own
     * department's results, and nothing outside it. There is deliberately no
     * tier above them — a college does not need one to run tests, and a
     * college-wide account is the account worth attacking.
     *
     * Empty for students, who are never scoped this way. A student sits
     * whichever papers they are on the allowlist for, which may span
     * departments — a shared first-year course is the normal case, not the
     * exception, so tagging students with one department would misfile them.
     */
    department: { type: String, default: '', trim: true, maxlength: 60, index: true },

    lastLoginAt: { type: Date },

    // Colleges identify students by roll number, not email.
    rollNumber: { type: String, default: '', trim: true },

    // Set once the student has confirmed their own name rather than inheriting
    // whatever the sign-in happened to supply. A test cannot be started until
    // this is set, so no result is ever attributed to an email alone.
    profileCompletedAt: { type: Date },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    email: this.email,
    name: this.name,
    picture: this.picture,
    role: this.role,
    department: this.department,
    rollNumber: this.rollNumber,
    profileComplete: Boolean(this.profileCompletedAt),
    // An HOD who has never named their department cannot be scoped to
    // anything, so the client asks them once before letting them work.
    needsDepartment: this.role === 'admin' && !this.department,
  };
};

/**
 * Has this account ever signed in?
 *
 * An HOD adds staff by email before those people have accounts, so the record
 * exists with the role and department already set and nothing else. Telling the
 * two apart matters on the staff screen: "invited" and "active" are different
 * things to an HOD chasing someone who has not turned up yet.
 */
userSchema.methods.hasSignedIn = function hasSignedIn() {
  return Boolean(this.lastLoginAt);
};

export const User = mongoose.model('User', userSchema);
