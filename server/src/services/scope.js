import { User } from '../models/User.js';

/**
 * Who a member of staff is allowed to see the work of.
 *
 * A teacher sees their own tests and questions. An HOD sees everything set by
 * their own department — which is what makes the head-of-department view useful
 * without needing students tagged with a department at all: the paper belongs to
 * whoever set it, so a shared first-year course counts for the department that
 * actually ran it, and a teacher taking three branches is not a special case.
 *
 * An HOD who has not yet named their department is scoped to themselves rather
 * than to everything. Falling back to "see it all" would be the wrong way round:
 * a missing value must never widen access.
 */
export async function visibleCreatorIds(user) {
  if (user.role !== 'admin' || !user.department) return [user._id];

  const staff = await User.find({
    department: user.department,
    role: { $in: ['teacher', 'admin'] },
  }).select('_id');

  const ids = staff.map((s) => s._id);
  // Their own id even if their staff record somehow does not match the filter,
  // so an HOD can never be locked out of their own work.
  if (!ids.some((id) => id.toString() === user._id.toString())) ids.push(user._id);
  return ids;
}

/** A Mongo filter limiting a query to what this user may see. */
export async function ownershipFilter(user) {
  return { createdBy: { $in: await visibleCreatorIds(user) } };
}

/** May this user open something created by `creatorId`? */
export async function canReach(user, creatorId) {
  const ids = await visibleCreatorIds(user);
  return ids.some((id) => id.toString() === creatorId.toString());
}
