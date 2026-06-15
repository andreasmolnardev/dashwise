
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function Page() {
  //check if authed, then load config, then redirect to default page or 
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/auth", { replace: true });
  }, [navigate]);
  return null;
}
