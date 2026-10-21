-- Run after 20261103000000_operator_remove_reported: makes the API see its two
-- functions at once ("Could not find the function ... in the schema cache").
notify pgrst, 'reload schema';
