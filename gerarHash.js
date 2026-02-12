import bcrypt from "bcrypt";

const senha = "Admin123";

bcrypt.hash(senha, 10).then(hash => {
  console.log("HASH GERADO:");
  console.log(hash);
});
