const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const { db } = require('./db');
const { User, Role, Permission, RolePermission, UserPermission } = require('./models');

async function migrate() {
  try {
    await db.sync({ force: true });
    console.log('Database migrated successfully');
  } catch (error) {
    console.error('Error migrating database:', error);
  }
}

async function seed() {
  try {
    const adminRole = await Role.create({ name: 'admin' });
    const userRole = await Role.create({ name: 'user' });

    const adminPermission = await Permission.create({ name: 'admin' });
    const userPermission = await Permission.create({ name: 'user' });

    await RolePermission.create({ roleId: adminRole.id, permissionId: adminPermission.id });
    await RolePermission.create({ roleId: userRole.id, permissionId: userPermission.id });

    const adminUser = await User.create({ email: 'admin@example.com', password: 'password', roleId: adminRole.id });
    const user = await User.create({ email: 'user@example.com', password: 'password', roleId: userRole.id });

    await UserPermission.create({ userId: adminUser.id, permissionId: adminPermission.id });
    await UserPermission.create({ userId: user.id, permissionId: userPermission.id });

    console.log('Database seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

async function run() {
  await migrate();
  await seed();
}

run();